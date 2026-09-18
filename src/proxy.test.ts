import { describe, expect, test } from "bun:test";
import {
  createServer as createNetServer,
  connect as netConnect,
  type Socket,
} from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proxiedFetchVia } from "./proxy.js";

// A stand-in for the actuator's host_proxy: a CONNECT proxy over a UNIX socket
// that tunnels an allowed host and refuses the rest. The SDK's real dial +
// requestOverTunnel run against it, so this exercises the hand-rolled
// ChunkedDecoder — the one place the TS tunnel parses HTTP itself.
function miniProxy(
  sockPath: string,
  allowedHost: string,
): Promise<{ stop: () => void }> {
  const srv = createNetServer((client: Socket) => {
    let head = Buffer.alloc(0);
    const onData = (d: Buffer) => {
      head = Buffer.concat([head, d]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      client.removeListener("data", onData);
      const firstLine = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
      const target = firstLine.split(" ")[1] ?? "";
      const [host, portStr] = target.split(":");
      if (host !== allowedHost) {
        client.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
        client.end();
        return;
      }
      const up = netConnect(Number(portStr), host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const residual = head.subarray(end + 4);
        if (residual.length) up.write(residual);
        client.pipe(up);
        up.pipe(client);
      });
      up.on("error", () => client.destroy());
    };
    client.on("data", onData);
  });
  return new Promise((resolve) =>
    srv.listen(sockPath, () => resolve({ stop: () => srv.close() })),
  );
}

const sockPath = () => join(tmpdir(), `bkp-${process.pid}-${Math.random().toString(36).slice(2)}.sock`);

describe("proxiedFetchVia over a CONNECT tunnel", () => {
  // The exact shape that truncated the Python SDK: a large CHUNKED body with
  // Connection: close. requestOverTunnel forces `connection: close`, so the
  // target closes after the terminator — the body must still arrive whole.
  test("large chunked body with Connection: close arrives whole", async () => {
    const N = 128 * 1024;
    const payload = Buffer.alloc(N);
    for (let i = 0; i < N; i++) payload[i] = 65 + (i % 26);
    const target = createHttpServer((_req, res) => {
      // No Content-Length -> node emits Transfer-Encoding: chunked.
      for (let off = 0; off < N; off += 4096) res.write(payload.subarray(off, Math.min(off + 4096, N)));
      res.end();
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const port = (target.address() as { port: number }).port;
    const sp = sockPath();
    const { stop } = await miniProxy(sp, "127.0.0.1");
    try {
      const f = proxiedFetchVia(`unix://${sp}`, fetch);
      const res = await f(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect((res.headers.get("transfer-encoding") ?? "").toLowerCase()).toContain("chunked");
      const body = new Uint8Array(await res.arrayBuffer());
      expect(body.length).toBe(N);
      expect(body[0]).toBe(65);
      expect(body[N - 1]).toBe(65 + ((N - 1) % 26));
    } finally {
      stop();
      target.close();
    }
  });

  // A raw server that writes a valid chunked response across several packets
  // and closes the socket IMMEDIATELY after the terminating 0-chunk. Stresses
  // the decoder's cross-packet framing and the close-right-after-terminator
  // timing that the Python bug turned into a truncation.
  test("chunked across packets, socket closed right after the terminator", async () => {
    const bodyText = "x".repeat(559);
    const target = createNetServer((c: Socket) => {
      c.once("data", () => {
        c.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
        c.write(`${bodyText.length.toString(16)}\r\n`);
        c.write(bodyText);
        c.write("\r\n");
        c.write("0\r\n\r\n");
        c.end();
      });
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const port = (target.address() as { port: number }).port;
    const sp = sockPath();
    const { stop } = await miniProxy(sp, "127.0.0.1");
    try {
      const f = proxiedFetchVia(`unix://${sp}`, fetch);
      const res = await f(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body.length).toBe(559);
    } finally {
      stop();
      target.close();
    }
  });

  // Content-Length path (the case that always worked, kept as a control).
  test("content-length body arrives whole", async () => {
    const target = createHttpServer((_req, res) => {
      const b = Buffer.from('{"ok":true}');
      res.setHeader("Content-Length", String(b.length));
      res.end(b);
    });
    await new Promise<void>((r) => target.listen(0, "127.0.0.1", () => r()));
    const port = (target.address() as { port: number }).port;
    const sp = sockPath();
    const { stop } = await miniProxy(sp, "127.0.0.1");
    try {
      const f = proxiedFetchVia(`unix://${sp}`, fetch);
      const res = await f(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe('{"ok":true}');
    } finally {
      stop();
      target.close();
    }
  });
});
