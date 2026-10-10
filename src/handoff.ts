/**
 * The proxy handoff (`BRANCHKIT_PROXY=fd://N`, Linux): the actuator hands
 * each connection to the plugin's filtering proxy over an inherited channel,
 * so the plugin never opens a socket or names a path (the sandbox forbids
 * both). Ask with one byte; the reply is one byte carrying a connected socket
 * (SCM_RIGHTS), already served with this plugin's proxy rules. Every reply is
 * an equivalent fresh connection, so asks only need serialising.
 *
 * Bun only. TS plugins run under Bun unless they declare `sockets.listen`
 * (built on Node because Bun cannot serve an inherited listener,
 * oven-sh/bun#22559); those have no network on Linux until that is fixed.
 * Node has no way to receive a passed descriptor, and Bun's
 * `net.Socket({ fd })` is a dead socket (measured on Bun 1.3.14), so the
 * descriptor is received through `bun:ffi` and used through `Bun.file(fd)`
 * streams, which carry a socket in both directions (TLS included).
 */

import { Duplex } from "node:stream";

/** BRANCHKIT_PROXY is a handed-off channel and this runtime cannot receive a
 * passed socket (Node). Run the plugin under Bun. */
export class ProxyHandoffUnsupportedError extends Error {
  constructor() {
    super(
      "BRANCHKIT_PROXY is a handed-off channel (fd://), which needs the Bun runtime: " +
        "Node cannot receive a passed socket",
    );
    this.name = "ProxyHandoffUnsupportedError";
  }
}

const HANDOFF_TIMEOUT_MS = 10_000;

// struct msghdr / cmsghdr layouts: Linux (glibc, 64-bit) and macOS (64-bit).
const MAC = process.platform === "darwin";
const LAYOUT = MAC
  ? { size: 48, iov: 16, iovlen: 24, control: 32, controllen: 40, cmsgData: 12, cmsgSpace: 16, dontwait: 0x80, wide: false }
  : { size: 56, iov: 16, iovlen: 24, control: 32, controllen: 40, cmsgData: 16, cmsgSpace: 24, dontwait: 0x40, wide: true };
const SOL_SOCKET = MAC ? 0xffff : 1;
const SCM_RIGHTS = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let libc: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ffi: any = null;

async function loadLibc(): Promise<void> {
  if (libc) return;
  // A string specifier keeps Node's loader from resolving it statically.
  const mod = "bun:ffi";
  ffi = await import(mod);
  const { FFIType } = ffi;
  libc = ffi.dlopen(MAC ? "libc.dylib" : "libc.so.6", {
    send: { args: [FFIType.i32, FFIType.ptr, FFIType.u64, FFIType.i32], returns: FFIType.i32 },
    recvmsg: { args: [FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  });
}

let chain: Promise<unknown> = Promise.resolve();

/** Replies asked for and not yet read, per channel. A read that gives up
 * leaves its reply to arrive later; each is read and discarded before the
 * next ask, so a dial always takes the reply to its own ask, never an
 * earlier one. */
const owed = new Map<number, number>();

/** The channel did not answer before the deadline. */
class NoAnswerError extends Error {}

/** Ask the channel at `channelFd` for one proxy connection. `timeoutMs`
 * bounds the wait for the channel's answer. */
export function handoffConnection(channelFd: number, timeoutMs = HANDOFF_TIMEOUT_MS): Promise<Duplex> {
  if (!process.versions.bun) return Promise.reject(new ProxyHandoffUnsupportedError());
  const next = chain.then(() => receiveOne(channelFd, timeoutMs));
  chain = next.catch(() => undefined);
  return next;
}

async function receiveOne(channelFd: number, timeoutMs: number): Promise<Duplex> {
  await loadLibc();
  const deadline = Date.now() + timeoutMs;
  while ((owed.get(channelFd) ?? 0) > 0) {
    let late: number | null;
    try {
      late = await readReply(channelFd, deadline);
    } catch (e) {
      if (e instanceof NoAnswerError) {
        throw new Error("the proxy channel has not yet answered an earlier ask");
      }
      throw e;
    }
    if (late !== null) closeFd(late);
  }
  const ask = new Uint8Array([0x63]);
  if (libc.symbols.send(channelFd, ffi.ptr(ask), 1, 0) !== 1) {
    throw new Error("could not ask the proxy channel for a connection");
  }
  owed.set(channelFd, (owed.get(channelFd) ?? 0) + 1);
  const fd = await readReply(channelFd, deadline);
  if (fd === null) throw new Error("the proxy channel replied without a connection");
  return fdStream(fd);
}

/** Read one reply off the channel: the descriptor it carries, or null for a
 * reply without one. Throws NoAnswerError, having taken nothing off the
 * channel, if no reply comes before `deadline`. */
async function readReply(channelFd: number, deadline: number): Promise<number | null> {
  const byte = new Uint8Array(8);
  const iov = new Uint8Array(16);
  const iv = new DataView(iov.buffer);
  iv.setBigUint64(0, BigInt(ffi.ptr(byte)), true);
  iv.setBigUint64(8, 1n, true);
  const control = new Uint8Array(64);
  const msg = new Uint8Array(LAYOUT.size);
  for (;;) {
    msg.fill(0);
    control.fill(0);
    const m = new DataView(msg.buffer);
    m.setBigUint64(LAYOUT.iov, BigInt(ffi.ptr(iov)), true);
    if (LAYOUT.wide) m.setBigUint64(LAYOUT.iovlen, 1n, true);
    else m.setInt32(LAYOUT.iovlen, 1, true);
    m.setBigUint64(LAYOUT.control, BigInt(ffi.ptr(control)), true);
    if (LAYOUT.wide) m.setBigUint64(LAYOUT.controllen, BigInt(control.length), true);
    else m.setUint32(LAYOUT.controllen, control.length, true);
    const n = libc.symbols.recvmsg(channelFd, ffi.ptr(msg), LAYOUT.dontwait);
    if (n === 0) throw new Error("the proxy channel closed");
    if (n > 0) {
      owed.set(channelFd, (owed.get(channelFd) ?? 1) - 1);
      const c = new DataView(control.buffer);
      if (c.getInt32(LAYOUT.cmsgData - 8, true) !== SOL_SOCKET || c.getInt32(LAYOUT.cmsgData - 4, true) !== SCM_RIGHTS) {
        return null;
      }
      return c.getInt32(LAYOUT.cmsgData, true);
    }
    if (Date.now() > deadline) throw new NoAnswerError("the proxy channel did not answer");
    await Bun.sleep(1);
  }
}

/** Close a received descriptor. Bun's writer does not close one it was given
 * by number on end() (measured on the Linux VM, Bun 1.3.14: fifty handed-off
 * connections left fifty descriptors open), so the stream closes it. */
function closeFd(fd: number): void {
  libc.symbols.close(fd);
}

/** A Duplex over a socket descriptor, through what works in Bun: Bun.file(fd). */
function fdStream(fd: number): Duplex {
  const writer = Bun.file(fd).writer();
  const reader = Bun.file(fd).stream().getReader();
  let pumping = false;
  let closed = false;
  const d: Duplex = new Duplex({
    read() {
      if (pumping) return;
      pumping = true;
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              d.push(null);
              return;
            }
            if (!d.push(Buffer.from(value))) {
              pumping = false;
              return;
            }
          }
        } catch (e) {
          if (!closed) d.destroy(e as Error);
        }
      })();
    },
    write(chunk, _enc, cb) {
      try {
        writer.write(chunk);
        Promise.resolve(writer.flush()).then(() => cb(), cb);
      } catch (e) {
        cb(e as Error);
      }
    },
    destroy(err, cb) {
      closed = true;
      void reader.cancel().catch(() => undefined);
      try {
        writer.end();
      } catch {
        // already closed
      }
      closeFd(fd);
      cb(err);
    },
  });
  return d;
}
