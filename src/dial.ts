/**
 * Raw TCP to a declared host — for a protocol that is not HTTP: MQTT, a
 * telnet-controlled receiver, a Redis-like local daemon. It is the same
 * CONNECT tunnel the HTTP transport uses, so it is enforced and recorded
 * exactly like HTTP.
 *
 * Inside the sandbox the plugin has no direct egress; the platform's
 * filtering proxy is the only route and it enforces the manifest's declared
 * host allowlist. `dial` is that route: when BRANCHKIT_PROXY is set the
 * connection is a CONNECT tunnel through the proxy (unix:// on Linux and
 * macOS, npipe:// on Windows — the same dial the SDK's patched `fetch`
 * uses), and the proxy records every attempt as `plugin.network_connect`.
 * When BRANCHKIT_PROXY is unset (an unsandboxed dev run) the dial is direct.
 */

import { connect as netConnect, type Socket } from "node:net";
import { HostRefusedError, abortError, connectTunnel, parseProxyUrl } from "./proxy.js";

/**
 * Open a raw TCP connection to `host:port`, resolving with an ordinary
 * `net.Socket`. The host must be one the manifest declares; anything else
 * is refused by the proxy and rejects with a {@link HostRefusedError}:
 *
 * ```ts
 * let sock: Socket;
 * try {
 *   sock = await dial("homeassistant.local", 1883);
 * } catch (e) {
 *   if (e instanceof HostRefusedError) {
 *     // the manifest does not declare this host — tell the user, don't retry
 *   }
 *   throw e;
 * }
 * ```
 *
 * `signal` bounds the connect (the proxy dial and the CONNECT handshake
 * included), not later reads and writes — use `sock.setTimeout` for those.
 *
 * TLS is the caller's: wrap the socket with `node:tls`'s `connect({ socket,
 * servername })` and let it verify the certificate. The proxy tunnels bytes
 * opaquely and never terminates TLS, so the allowlist decides which NAME
 * you may dial, not who answers.
 */
export function dial(
  host: string,
  port: number,
  opts: { signal?: AbortSignal } = {},
): Promise<Socket> {
  if (!host) return Promise.reject(new Error("dial: empty host"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error(`dial: port ${port} out of range 1-65535`));
  }
  const v = process.env.BRANCHKIT_PROXY;
  if (v) {
    // Unlike the fetch patch (which logs and leaves fetch direct at import
    // time, where there is no caller to tell), a raw dial has one: a
    // malformed endpoint is an error here, not a silent direct dial that
    // dies in the sandbox anyway. parseProxyUrl throws synchronously.
    let endpoint;
    try {
      endpoint = parseProxyUrl(v);
    } catch (e) {
      return Promise.reject(e);
    }
    return connectTunnel(endpoint, host, port, opts.signal);
  }
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError());
      return;
    }
    const sock = netConnect(port, host);
    const onAbort = () => {
      sock.destroy();
      settle(() => reject(abortError()));
    };
    const onError = (e: Error) => settle(() => reject(e));
    const onConnect = () => settle(() => resolve(sock));
    let done = false;
    function settle(outcome: () => void) {
      if (done) return;
      done = true;
      opts.signal?.removeEventListener("abort", onAbort);
      sock.removeListener("error", onError);
      sock.removeListener("connect", onConnect);
      outcome();
    }
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    sock.on("error", onError);
    sock.on("connect", onConnect);
  });
}
