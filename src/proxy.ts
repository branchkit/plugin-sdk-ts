/**
 * Transparent outbound proxy (the actuator's per-host network enforcement —
 * see the actuator's docs/design/DESIGN_SANDBOX_HOST_PROXY.md).
 *
 * When a plugin declares `"network": {"hosts": [...]}`, platforms without an
 * in-kernel per-host primitive (Linux, later Windows) run the plugin in a
 * no-network sandbox whose only egress is an actuator-run HTTP CONNECT proxy
 * enforcing the declared hostname allowlist. The actuator advertises the
 * endpoint in BRANCHKIT_PROXY:
 *
 *   unix:///path/to/endpoint.sock  — UNIX socket (Linux; bind-mounted into
 *                                    the sandbox at the same path)
 *   http://127.0.0.1:<port>        — localhost TCP (Windows, P3)
 *
 * The SDK patches `globalThis.fetch` at import time so a plugin author
 * writes ordinary `fetch()` calls and the platform routes and enforces.
 * TLS is tunneled opaquely (CONNECT, then a normal client-side handshake —
 * the proxy never sees plaintext). When BRANCHKIT_PROXY is unset (macOS
 * in-kernel enforcement, unsandboxed dev), fetch is left untouched.
 *
 * The tunnel client is hand-rolled over node:net/node:tls with minimal
 * HTTP/1.1 response parsing, because Bun (the plugin runtime) neither
 * honors node:http's `createConnection` nor supports proxies over UNIX
 * sockets natively. Response bodies stream as they arrive (chunked decoding
 * included), so SSE/streaming responses are not buffered.
 */

import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

/** Statuses that carry a Location the client is expected to follow. */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Matches WHATWG fetch (and undici); Go's http.Client caps at 10. */
const MAX_REDIRECTS = 20;

interface ProxyEndpoint {
  kind: "unix" | "tcp";
  path: string; // unix: socket path
  host: string; // tcp: proxy host
  port: number; // tcp: proxy port
}

/** Parse a BRANCHKIT_PROXY value. Throws on unsupported schemes. */
export function parseProxyUrl(v: string): ProxyEndpoint {
  if (v.startsWith("unix://")) {
    const path = v.slice("unix://".length);
    if (!path) throw new Error(`empty proxy socket path in ${JSON.stringify(v)}`);
    return { kind: "unix", path, host: "", port: 0 };
  }
  if (v.startsWith("http://")) {
    const rest = v.slice("http://".length).replace(/\/+$/, "");
    const i = rest.lastIndexOf(":");
    const port = i === -1 ? NaN : Number(rest.slice(i + 1));
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`proxy url ${JSON.stringify(v)} needs an explicit port`);
    }
    return { kind: "tcp", path: "", host: rest.slice(0, i), port };
  }
  throw new Error(
    `unsupported BRANCHKIT_PROXY ${JSON.stringify(v)} (want unix:// or http://)`,
  );
}

/** Dial the proxy endpoint and complete the CONNECT handshake to host:port.
 * Resolves with a socket that is an opaque tunnel to the target. The target
 * hostname travels BY NAME — the proxy resolves it host-side (inside the
 * sandbox there is no DNS) and refuses hosts outside the allowlist. */
function connectTunnel(
  endpoint: ProxyEndpoint,
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const sock =
      endpoint.kind === "unix"
        ? netConnect(endpoint.path)
        : netConnect(endpoint.port, endpoint.host);
    let head = Buffer.alloc(0);
    let settled = false;

    // The caller's AbortSignal MUST cover this phase, not just the request that
    // follows it. Previously the signal was wired only in requestOverTunnel, so
    // UpstreamClient's 10s timeout could not fire while the proxy dial or the
    // CONNECT handshake hung — the request sat forever and the socket leaked.
    const onAbort = () => fail(abortError());
    const done = () => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      sock.removeListener("data", onData);
      sock.removeListener("error", fail);
    };
    function fail(err: Error) {
      if (settled) return;
      done();
      sock.destroy();
      reject(err);
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    sock.on("error", fail);
    sock.on("connect", () => {
      sock.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    function onData(d: Buffer) {
      head = Buffer.concat([head, d]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) {
        if (head.length > 4096) fail(new Error("oversized CONNECT response"));
        return;
      }
      const status = head.subarray(0, end).toString("latin1").split("\r\n")[0] ?? "";
      const code = status.split(/\s+/)[1];
      if (code !== "200") {
        fail(
          new Error(
            `branchkit proxy refused CONNECT ${host}:${port}: ${status} ` +
              `(host not in the plugin's declared allowlist?)`,
          ),
        );
        return;
      }
      if (settled) return;
      done();
      // Nothing follows the 200 head until we speak, so no residual bytes.
      resolve(sock);
    }
    sock.on("data", onData);
  });
}

function abortError(): Error {
  return new DOMException("This operation was aborted", "AbortError");
}

/** Incremental Transfer-Encoding: chunked decoder. Feed raw bytes, receive
 * decoded data chunks via onData; onEnd fires at the terminal chunk. */
class ChunkedDecoder {
  private buf: Buffer = Buffer.alloc(0);
  private remaining = 0; // bytes left in the current chunk's data
  private done = false;

  constructor(
    private onData: (d: Buffer) => void,
    private onEnd: () => void,
  ) {}

  feed(d: Buffer): void {
    if (this.done) return;
    this.buf = this.buf.length === 0 ? d : Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.remaining > 0) {
        if (this.buf.length === 0) return;
        const take = Math.min(this.remaining, this.buf.length);
        this.onData(this.buf.subarray(0, take));
        this.buf = this.buf.subarray(take);
        this.remaining -= take;
        if (this.remaining === 0) {
          // Consume the CRLF that terminates the chunk data (may not have
          // arrived yet — handled by the size-line parse below tolerating
          // a leading CRLF).
        }
        continue;
      }
      // Between chunks: skip a leading CRLF, then read the size line.
      if (this.buf.subarray(0, 2).toString("latin1") === "\r\n") {
        this.buf = this.buf.subarray(2);
      }
      const nl = this.buf.indexOf("\r\n");
      if (nl === -1) return; // size line incomplete
      const sizeLine = this.buf.subarray(0, nl).toString("latin1");
      const size = Number.parseInt(sizeLine.split(";")[0]!.trim(), 16);
      if (!Number.isFinite(size) || size < 0) {
        // Malformed framing — end the stream rather than hang.
        this.done = true;
        this.onEnd();
        return;
      }
      this.buf = this.buf.subarray(nl + 2);
      if (size === 0) {
        this.done = true;
        this.onEnd(); // trailers (if any) are ignored
        return;
      }
      this.remaining = size;
    }
  }
}

/** Issue one HTTP/1.1 request over an established tunnel socket and adapt
 * the response to a WHATWG Response with a streaming body. */
function requestOverTunnel(
  sock: Socket,
  url: URL,
  method: string,
  reqHeaders: Headers,
  bodyBytes: Uint8Array | null,
  signal: AbortSignal | undefined,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const path = (url.pathname || "/") + url.search;
    const lines = [`${method} ${path} HTTP/1.1`];
    // Copy: the caller reuses its Headers across redirect hops.
    const headers = new Headers(reqHeaders);
    headers.set("host", url.host);
    // One request per tunnel: the proxy tunnels a single connection, and
    // read-to-EOF is the universal body terminator.
    headers.set("connection", "close");
    if (bodyBytes && bodyBytes.length > 0 && !headers.has("content-length")) {
      headers.set("content-length", String(bodyBytes.length));
    }
    headers.forEach((v, k) => lines.push(`${k}: ${v}`));
    sock.write(lines.join("\r\n") + "\r\n\r\n");
    if (bodyBytes && bodyBytes.length > 0) sock.write(bodyBytes);

    let head = Buffer.alloc(0);
    let settled = false;
    const onAbort = () => {
      sock.destroy();
      if (!settled) {
        settled = true;
        reject(new DOMException("This operation was aborted", "AbortError"));
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const failEarly = (err: Error) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        sock.destroy();
        reject(err);
      }
    };
    sock.on("error", (e) => failEarly(e as Error));

    const onHeadData = (d: Buffer) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) {
        if (head.length > 65536) failEarly(new Error("oversized response head"));
        return;
      }
      sock.removeListener("data", onHeadData);

      const headText = head.subarray(0, end).toString("latin1");
      const residual = head.subarray(end + 4);
      const [statusLine = "", ...headerLines] = headText.split("\r\n");
      const m = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})\s*(.*)$/);
      if (!m) {
        failEarly(new Error(`malformed response status line: ${statusLine}`));
        return;
      }
      const status = Number(m[1]);
      const statusText = m[2] ?? "";
      const respHeaders = new Headers();
      for (const line of headerLines) {
        const i = line.indexOf(":");
        if (i > 0) respHeaders.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }

      const bodyless =
        method === "HEAD" || status === 204 || status === 304 || status < 200;
      if (bodyless) {
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        sock.destroy();
        resolve(new Response(null, { status, statusText, headers: respHeaders }));
        return;
      }

      const chunked =
        (respHeaders.get("transfer-encoding") ?? "").toLowerCase().includes("chunked");
      const contentLength = respHeaders.has("content-length")
        ? Number(respHeaders.get("content-length"))
        : NaN;
      let received = 0;
      let streamDone = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const finish = () => {
            if (streamDone) return;
            streamDone = true;
            try {
              controller.close();
            } catch {
              // already closed/errored
            }
            sock.destroy();
          };
          const emit = (d: Buffer) => {
            if (streamDone || d.length === 0) return;
            controller.enqueue(new Uint8Array(d));
            received += d.length;
            if (!chunked && Number.isFinite(contentLength) && received >= contentLength) {
              finish();
            }
          };
          const decoder = chunked ? new ChunkedDecoder(emit, finish) : null;
          const onBody = (d: Buffer) => (decoder ? decoder.feed(d) : emit(d));
          if (residual.length > 0) onBody(residual);
          sock.on("data", onBody);
          sock.on("end", finish);
          sock.on("close", finish);
          sock.on("error", (e) => {
            if (!streamDone) {
              streamDone = true;
              controller.error(e);
            }
          });
          if (!chunked && Number.isFinite(contentLength) && contentLength === 0) {
            finish();
          }
        },
        cancel() {
          streamDone = true;
          sock.destroy();
        },
      });

      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(new Response(stream, { status, statusText, headers: respHeaders }));
    };
    sock.on("data", onHeadData);
  });
}

/** A fetch()-compatible function routing http/https through the CONNECT
 * proxy endpoint. Non-HTTP schemes fall through to `base`. */
export function proxiedFetchVia(
  proxyUrl: string,
  base: typeof fetch,
): typeof fetch {
  const endpoint = parseProxyUrl(proxyUrl);
  const proxied = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return base(input, init);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return base(input, init);
    }
    const req = new Request(input as RequestInfo, init);
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined) ?? undefined;

    let method = req.method;
    let bodyBytes =
      method === "GET" || method === "HEAD" ? null : new Uint8Array(await req.arrayBuffer());
    const headers = new Headers(req.headers);
    const redirectMode = req.redirect || "follow";
    let current = url;

    // Redirect following, because unproxied `fetch` follows and this function
    // stands in for it — without the loop the SAME plugin code got a bare 3xx
    // when sandboxed and the final response when not. Cap and semantics match
    // WHATWG fetch (20 hops; 303, and 301/302-on-POST, rewrite to GET).
    for (let hop = 0; ; hop++) {
      if (signal?.aborted) throw abortError();

      const port = current.port
        ? Number(current.port)
        : current.protocol === "https:"
          ? 443
          : 80;
      const raw = await connectTunnel(endpoint, current.hostname, port, signal);
      const sock =
        current.protocol === "https:"
          ? (tlsConnect({ socket: raw, servername: current.hostname }) as unknown as Socket)
          : raw;
      const res = await requestOverTunnel(sock, current, method, headers, bodyBytes, signal);

      const location = res.headers.get("location");
      if (!REDIRECT_STATUS.has(res.status) || !location) return res;
      if (redirectMode === "manual") return res;
      if (redirectMode === "error") {
        await res.body?.cancel();
        throw new TypeError(`unexpected redirect (${res.status}) to ${location}`);
      }
      if (hop >= MAX_REDIRECTS) {
        await res.body?.cancel();
        throw new TypeError(`too many redirects (${MAX_REDIRECTS})`);
      }

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return res; // unparseable Location — hand the 3xx back rather than guess
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        await res.body?.cancel();
        throw new TypeError(`redirect to unsupported scheme ${next.protocol}`);
      }

      // Release the tunnel before dialing the next hop.
      await res.body?.cancel();

      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        bodyBytes = null;
        headers.delete("content-length");
        headers.delete("content-type");
      }
      // Credentials must not follow a hop to a different origin — same rule
      // WHATWG fetch applies. (The proxy would also refuse a host outside the
      // manifest allowlist, but that is a second line of defense, not the first.)
      if (next.origin !== current.origin) {
        headers.delete("authorization");
        headers.delete("cookie");
      }
      current = next;
    }
  };
  return proxied as typeof fetch;
}

/**
 * Patch `globalThis.fetch` to route through BRANCHKIT_PROXY. No-op when the
 * env var is unset (direct egress: macOS in-kernel per-host, dev runs).
 * Called once from the SDK entry module.
 */
export function installProxyFromEnv(): void {
  const v = process.env.BRANCHKIT_PROXY;
  if (!v) return;
  try {
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = proxiedFetchVia(v, original);
  } catch (e) {
    // A malformed value must not take the plugin down at import time —
    // requests will go direct and die in the sandbox, which is visible.
    console.error(`[branchkit-sdk] ignoring invalid BRANCHKIT_PROXY: ${String(e)}`);
  }
}

installProxyFromEnv();
