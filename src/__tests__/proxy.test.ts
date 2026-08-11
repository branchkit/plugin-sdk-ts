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

  // Unproxied fetch follows redirects; the proxied path resolved the bare 3xx,
  // so the SAME plugin code behaved differently sandboxed vs not.
  test("follows redirects to the final response", async () => {
    const target = createServer((req, res) => {
      if (req.url === "/start") {
        res.writeHead(302, { location: "/hop" });
        res.end();
      } else if (req.url === "/hop") {
        res.writeHead(302, { location: "/end" });
        res.end();
      } else {
        res.end("arrived");
      }
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/start`);
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("arrived");
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("303 and 302-on-POST rewrite the method to GET and drop the body", async () => {
    const seen: Array<{ method: string; body: string }> = [];
    const target = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        seen.push({ method: req.method ?? "", body: b });
        if (req.url === "/submit") {
          res.writeHead(302, { location: "/done" });
          res.end();
        } else {
          res.end("ok");
        }
      });
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/submit`, {
        method: "POST",
        body: "payload=1",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      });
      expect(await resp.text()).toBe("ok");
      expect(seen[0]).toEqual({ method: "POST", body: "payload=1" });
      expect(seen[1]!.method).toBe("GET");
      expect(seen[1]!.body).toBe("");
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("redirect:'manual' hands back the 3xx unfollowed", async () => {
    const target = createServer((_req, res) => {
      res.writeHead(302, { location: "/elsewhere" });
      res.end();
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${targetPort}/`, { redirect: "manual" });
      expect(resp.status).toBe(302);
      expect(resp.headers.get("location")).toBe("/elsewhere");
    } finally {
      proxy.close();
      target.close();
    }
  });

  test("a redirect loop terminates instead of spinning forever", async () => {
    const target = createServer((_req, res) => {
      res.writeHead(302, { location: "/loop" });
      res.end();
    });
    const targetPort = await listenTcp(target);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      await expect(pf(`http://127.0.0.1:${targetPort}/loop`)).rejects.toThrow(/too many redirects/);
    } finally {
      proxy.close();
      target.close();
    }
  });

  // Origin includes the port, so a hop to a different port is cross-origin.
  test("Authorization is dropped on a cross-origin redirect", async () => {
    const authSeen: Array<string | undefined> = [];
    const second = createServer((req, res) => {
      authSeen.push(req.headers.authorization);
      res.end("second");
    });
    const secondPort = await listenTcp(second);
    const first = createServer((req, res) => {
      authSeen.push(req.headers.authorization);
      res.writeHead(302, { location: `http://127.0.0.1:${secondPort}/` });
      res.end();
    });
    const firstPort = await listenTcp(first);
    const proxy = miniProxy("127.0.0.1");
    const proxyPort = await listenTcp(proxy);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${proxyPort}`, fetch);
      const resp = await pf(`http://127.0.0.1:${firstPort}/`, {
        headers: { authorization: "Bearer secret" },
      });
      expect(await resp.text()).toBe("second");
      expect(authSeen[0]).toBe("Bearer secret");
      expect(authSeen[1]).toBeUndefined();
    } finally {
      proxy.close();
      first.close();
      second.close();
    }
  });

  // The AbortSignal used to be wired only AFTER the tunnel existed, so a proxy
  // that accepted and went silent hung the request past any timeout and leaked
  // the socket. UpstreamClient's 10s budget depends on this.
  test("abort fires while the CONNECT handshake is still hanging", async () => {
    // Accepts the connection, then never answers the CONNECT.
    const deaf = netServer(() => {});
    const deafPort = await listenTcp(deaf);
    try {
      const pf = proxiedFetchVia(`http://127.0.0.1:${deafPort}`, fetch);
      const started = Date.now();
      const attempt = pf("http://example.invalid/", { signal: AbortSignal.timeout(250) });
      await expect(
        Promise.race([
          attempt,
          new Promise((_, rej) => setTimeout(() => rej(new Error("HUNG past the abort")), 3000)),
        ]),
      ).rejects.toThrow(/abort/i);
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      deaf.close();
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
