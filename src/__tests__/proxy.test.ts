import { describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import {
  createServer as netServer,
  connect as netConnect,
  type Server as NetServer,
  type Socket,
} from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProxyUrl, proxiedFetchVia } from "../proxy.js";

/** Test-side CONNECT proxy mirroring the actuator's host_proxy: allow →
 * tunnel, deny → 403. */
function miniProxy(allowedHost: string): NetServer {
  return netServer((sock: Socket) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      sock.removeListener("data", onData);
      const line = buf.split("\r\n")[0] ?? "";
      const [method, target] = line.split(/\s+/);
      if (!method || method.toUpperCase() !== "CONNECT" || !target) {
        sock.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const [host, port] = target.split(":");
      if (host !== allowedHost) {
        sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      const up = netConnect(Number(port), host, () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        sock.pipe(up);
        up.pipe(sock);
      });
      up.on("error", () => sock.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n"));
      sock.on("error", () => up.destroy());
    };
    sock.on("data", onData);
  });
}

async function listenTcp(srv: NetServer | Server): Promise<number> {
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as { port: number }).port;
}

function shortSockPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "bkp"));
  return { path: join(dir, "p.sock"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("parseProxyUrl", () => {
  test("accepts unix:// and http:// forms, rejects the rest", () => {
    expect(parseProxyUrl("unix:///run/p.sock")).toEqual({
      kind: "unix",
      path: "/run/p.sock",
      host: "",
      port: 0,
    });
    expect(parseProxyUrl("http://127.0.0.1:9999")).toEqual({
      kind: "tcp",
      path: "",
      host: "127.0.0.1",
      port: 9999,
    });
    expect(() => parseProxyUrl("socks5://x")).toThrow();
    expect(() => parseProxyUrl("unix://")).toThrow();
    expect(() => parseProxyUrl("http://nohost")).toThrow();
  });
});

describe("proxied fetch", () => {
  test("allowed host round-trips through a UNIX-socket endpoint", async () => {
    const target = createServer((req, res) => {
      res.setHeader("x-echo-method", req.method ?? "");
      res.end("hello through the tunnel");
    });
    const targetPort = await listenTcp(target);

    const { path: sock, cleanup } = shortSockPath();
    const proxy = miniProxy("127.0.0.1");
    await new Promise<void>((r) => proxy.listen(sock, () => r()));
    try {
      const pf = proxiedFetchVia(`unix://${sock}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/x?q=1`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get("x-echo-method")).toBe("GET");
      expect(await resp.text()).toBe("hello through the tunnel");
    } finally {
      proxy.close();
      target.close();
      cleanup();
    }
  });

  test("POST body reaches the target through the tunnel", async () => {
    const target = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => res.end(`got:${b}`));
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/`, {
        method: "POST",
        body: JSON.stringify({ a: 1 }),
        headers: { "content-type": "application/json" },
      });
      expect(await resp.text()).toBe('got:{"a":1}');
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("non-declared host is refused by the proxy (no direct fallback)", async () => {
    const target = createServer((_req, res) => res.end("MUST NOT BE REACHED"));
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("no-such-host.invalid");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      await expect(pf(`http://127.0.0.1:${targetPort}/`)).rejects.toThrow(/refused CONNECT/);
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("chunked responses stream through incrementally (SSE shape)", async () => {
    const target = createServer((_req, res) => {
      res.setHeader("content-type", "text/event-stream");
      res.write("data: one\n\n");
      setTimeout(() => {
        res.write("data: two\n\n");
        res.end();
      }, 50);
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/`);
      const reader = resp.body!.getReader();
      const first = await reader.read();
      // The first event must arrive BEFORE the response completes —
      // streaming, not buffered-to-EOF.
      expect(new TextDecoder().decode(first.value)).toContain("data: one");
      let rest = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        rest += new TextDecoder().decode(value);
      }
      expect(rest).toContain("data: two");
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("non-http schemes fall through to the base fetch", async () => {
    let baseCalled = false;
    const base = (async () => {
      baseCalled = true;
      return new Response("base");
    }) as unknown as typeof fetch;
    const pf = proxiedFetchVia("http://127.0.0.1:1", base);
    const resp = await pf("data:text/plain,hi");
    expect(baseCalled).toBe(true);
    expect(await resp.text()).toBe("base");
  });
});
