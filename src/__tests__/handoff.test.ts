// The proxy handoff (fd://N): the SDK asks over an inherited channel and
// receives each connection as a passed socket. A Python stand-in for the
// actuator's broker holds the other end: per ask it makes a fresh pair,
// answers CONNECT with 200 on one end and echoes, and passes the other back.
import { describe, expect, test } from "bun:test";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { connectTunnel, parseProxyUrl } from "../proxy.js";

const BROKER = `
import socket
chan = socket.socket(fileno=3)
while True:
    if not chan.recv(1):
        break
    mine, theirs = socket.socketpair()
    socket.send_fds(chan, [b"c"], [theirs.fileno()])
    theirs.close()
    head = b""
    while b"\\r\\n\\r\\n" not in head:
        head += mine.recv(1)
    mine.sendall(b"HTTP/1.1 200 Connection Established\\r\\n\\r\\n")
    data = mine.recv(64)
    mine.sendall(b"echo:" + data)
    mine.close()
`;

function socketpair(): [number, number] {
  const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
    socketpair: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
  });
  const fds = new Int32Array(2);
  if (libc.symbols.socketpair(1 /* AF_UNIX */, 1 /* SOCK_STREAM */, 0, ptr(fds)) !== 0) {
    throw new Error("socketpair failed");
  }
  return [fds[0], fds[1]];
}

async function echoOnce(sock: import("node:stream").Duplex, msg: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    sock.once("data", (d) => resolve(d.toString()));
    sock.once("error", reject);
    sock.write(msg);
  });
}

describe("proxy handoff (fd://)", () => {
  test("parses fd:// and rejects a bad one", () => {
    expect(parseProxyUrl("fd://7")).toMatchObject({ kind: "fd", port: 7 });
    expect(() => parseProxyUrl("fd://")).toThrow();
    expect(() => parseProxyUrl("fd://x")).toThrow();
  });

  // Unix fd passing; the channel only ever exists on Linux.
  test.skipIf(process.platform === "win32")("each ask gets a working connection", async () => {
    const [mine, theirs] = socketpair();
    const broker = Bun.spawn(["python3", "-c", BROKER], {
      stdio: ["ignore", "inherit", "inherit", theirs],
    });
    try {
      const endpoint = parseProxyUrl(`fd://${mine}`);
      for (const msg of ["one", "two"]) {
        const sock = await connectTunnel(endpoint, "example.invalid", 443);
        expect(await echoOnce(sock, msg)).toBe(`echo:${msg}`);
        sock.destroy();
      }
    } finally {
      broker.kill();
    }
  });
});
