import { afterEach, describe, expect, test } from "bun:test";
import {
  createServer as netServer,
  connect as netConnect,
  type Server as NetServer,
  type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dial } from "../dial.js";
import { HostRefusedError } from "../proxy.js";

/** Test-side CONNECT proxy mirroring the actuator's host_proxy: allow →
 * tunnel, deny → 403. Same shape as proxy.test.ts's. */
function miniProxy(allowedHost: string): NetServer {
  return netServer((sock: Socket) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("latin1");
      const idx = buf.indexOf("\r\n\r\n");
      if (idx === -1) return;
      sock.removeListener("data", onData);
      const line = buf.split("\r\n")[0] ?? "";
      const [, target] = line.split(/\s+/);
      const [host, port] = (target ?? "").split(":");
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

/** TCP echo on loopback: every byte read is written back. */
function echoServer(): NetServer {
  return netServer((c: Socket) => {
    c.on("error", () => {});
    c.pipe(c);
  });
}

async function listenTcp(srv: NetServer): Promise<number> {
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return (srv.address() as { port: number }).port;
}

const sockPath = () =>
  join(tmpdir(), `bkd-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);

/** Write `msg`, resolve with the same number of bytes echoed back. */
function echoOnce(sock: Socket, msg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const want = Buffer.byteLength(msg);
    const timer = setTimeout(() => reject(new Error("echo timeout")), 5000);
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= want) {
        clearTimeout(timer);
        resolve(buf.toString("utf8"));
      }
    });
    sock.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    sock.write(msg);
  });
}

const savedEnv = process.env.BRANCHKIT_PROXY;
afterEach(() => {
  if (savedEnv === undefined) delete process.env.BRANCHKIT_PROXY;
  else process.env.BRANCHKIT_PROXY = savedEnv;
});

describe("dial (raw TCP through the platform proxy)", () => {
  // The G1 contract: bytes reach a declared host through the CONNECT proxy,
  // in both directions, with no HTTP framing in the way.
  test("echoes through a CONNECT proxy over a unix socket", async () => {
    const echo = echoServer();
    const port = await listenTcp(echo);
    const proxy = miniProxy("127.0.0.1");
    const sp = sockPath();
    await new Promise<void>((r) => proxy.listen(sp, () => r()));
    process.env.BRANCHKIT_PROXY = `unix://${sp}`;
    let sock: Socket | undefined;
    try {
      sock = await dial("127.0.0.1", port);
      expect(await echoOnce(sock, "raw tcp through the tunnel")).toBe(
        "raw tcp through the tunnel",
      );
    } finally {
      sock?.destroy();
      proxy.close();
      echo.close();
    }
  });

  // A host the manifest does not declare is refused by the proxy — as a
  // typed error, and with no direct fallback (the echo server IS reachable
  // directly from this test, so a bypass would succeed).
  test("undeclared host is refused with HostRefusedError, no direct fallback", async () => {
    const echo = echoServer();
    const port = await listenTcp(echo);
    const proxy = miniProxy("no-such-host.invalid");
    const proxyPort = await listenTcp(proxy);
    process.env.BRANCHKIT_PROXY = `http://127.0.0.1:${proxyPort}`;
    try {
      let caught: unknown;
      try {
        (await dial("127.0.0.1", port)).destroy();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HostRefusedError);
      const refused = caught as HostRefusedError;
      expect(refused.host).toBe("127.0.0.1");
      expect(refused.port).toBe(port);
      expect(refused.message).toMatch(/refused CONNECT/);
    } finally {
      proxy.close();
      echo.close();
    }
  });

  // Unset env means a direct dial — unsandboxed dev, or no `hosts` policy.
  test("dials direct when BRANCHKIT_PROXY is unset", async () => {
    delete process.env.BRANCHKIT_PROXY;
    const echo = echoServer();
    const port = await listenTcp(echo);
    let sock: Socket | undefined;
    try {
      sock = await dial("127.0.0.1", port);
      expect(await echoOnce(sock, "direct")).toBe("direct");
    } finally {
      sock?.destroy();
      echo.close();
    }
  });

  test("rejects bad arguments and a malformed endpoint", async () => {
    delete process.env.BRANCHKIT_PROXY;
    await expect(dial("", 80)).rejects.toThrow(/empty host/);
    await expect(dial("127.0.0.1", 0)).rejects.toThrow(/out of range/);
    await expect(dial("127.0.0.1", 70000)).rejects.toThrow(/out of range/);
    // A malformed endpoint is an error to the caller, never a silent direct dial.
    process.env.BRANCHKIT_PROXY = "socks5://nope";
    await expect(dial("127.0.0.1", 80)).rejects.toThrow(/unsupported BRANCHKIT_PROXY/);
  });

  test("an already-aborted signal rejects before dialing", async () => {
    delete process.env.BRANCHKIT_PROXY;
    const ctl = new AbortController();
    ctl.abort();
    await expect(dial("127.0.0.1", 9, { signal: ctl.signal })).rejects.toThrow(/aborted/);
  });
});
