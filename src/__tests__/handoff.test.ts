// The proxy handoff (fd://N): the SDK asks over an inherited channel and
// receives each connection as a passed socket. A Python stand-in for the
// actuator's broker holds the other end: per ask it makes a fresh pair,
// answers CONNECT with 200 on one end and echoes, and passes the other back.
import { describe, expect, test } from "bun:test";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { connectTunnel, parseProxyUrl } from "../proxy.js";
import { handoffConnection } from "../handoff.js";

// The broker keeps its copy of the passed end until the SDK has spoken on
// it. Closing it straight after send_fds leaves the message the socket's
// only reference while it waits in the channel, and macOS's unix-socket
// garbage collector then sometimes flushes it: the SDK receives a socket
// already shut for reading, and the proxy's 200 is discarded. Measured on
// macOS 15 with a pure-Python client, no Bun involved: one connection in
// roughly every 70-400 back-to-back ones arrived dead, none in 15,000 once
// the sender held its copy. With two connections per run that was the
// occasional timeout this test used to show.
const BROKER = `
import socket, sys
chan = socket.socket(fileno=3)
mode = sys.argv[1]
while True:
    if not chan.recv(1):
        break
    mine, theirs = socket.socketpair()
    socket.send_fds(chan, [b"c"], [theirs.fileno()])
    head = b""
    while b"\\r\\n\\r\\n" not in head:
        head += mine.recv(1)
    theirs.close()
    if mode == "hangup":
        mine.close()
        continue
    mine.sendall(b"HTTP/1.1 200 Connection Established\\r\\n\\r\\n")
    data = mine.recv(64)
    mine.sendall(b"echo:" + data)
    mine.close()
`;

// Answers the first ask late, after the SDK has given up on it, and tags
// each connection it hands over with its number. Holds every passed socket
// until it exits.
const LATE_BROKER = `
import socket, time
chan = socket.socket(fileno=3)
held = []
tag = 1
while True:
    if not chan.recv(1):
        break
    if tag == 1:
        time.sleep(0.3)
    mine, theirs = socket.socketpair()
    held += [mine, theirs]
    mine.sendall(str(tag).encode())
    socket.send_fds(chan, [b"c"], [theirs.fileno()])
    tag += 1
`;

function spawnBroker(mode: "echo" | "hangup", channel: number) {
  return Bun.spawn(["python3", "-c", BROKER, mode], {
    stdio: ["ignore", "inherit", "inherit", channel],
  });
}

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
    const broker = spawnBroker("echo", theirs);
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

  // A proxy that hangs up before answering CONNECT is an error at once, not
  // a wait for a 200 that cannot come.
  test.skipIf(process.platform === "win32")("a hang-up before the answer rejects", async () => {
    const [mine, theirs] = socketpair();
    const broker = spawnBroker("hangup", theirs);
    try {
      const endpoint = parseProxyUrl(`fd://${mine}`);
      await expect(connectTunnel(endpoint, "example.invalid", 443)).rejects.toThrow(
        "closed the connection during CONNECT",
      );
    } finally {
      broker.kill();
    }
  });

  // A dial whose wait for the channel gives up leaves its reply to arrive
  // later. The next dial must still get the connection answering ITS ask,
  // not that late one.
  test.skipIf(process.platform === "win32")("after a timed-out read, the next ask gets its own connection", async () => {
    const [mine, theirs] = socketpair();
    const broker = Bun.spawn(["python3", "-c", LATE_BROKER], {
      stdio: ["ignore", "inherit", "inherit", theirs],
    });
    try {
      await expect(handoffConnection(mine, 50)).rejects.toThrow("did not answer");
      const sock = await handoffConnection(mine, 5000);
      const tag = await new Promise<string>((resolve, reject) => {
        sock.once("data", (d) => resolve(d.toString()));
        sock.once("error", reject);
      });
      sock.destroy();
      expect(tag).toBe("2");
    } finally {
      broker.kill();
    }
  });
});
