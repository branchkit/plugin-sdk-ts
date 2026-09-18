import { connect, type Socket } from "node:net";
import type { Server } from "node:http";

/**
 * The actuator's listener relay (its docs/design/DESIGN_WINDOWS_LISTENER_RELAY.md).
 *
 * On Windows a plugin runs in an AppContainer whose loopback exemption is
 * outbound-only: a listener the plugin binds itself is unreachable from
 * outside. So there the actuator binds the declared listeners OUTSIDE the
 * sandbox and relays each inbound connection over a connection the plugin
 * opened outward. The plugin parks a few such connections at the actuator's
 * per-spawn rendezvous (BRANCHKIT_LISTEN_RELAY, presenting
 * BRANCHKIT_LISTEN_RELAY_TOKEN on the first line); when a client arrives the
 * actuator writes "OK\n" on one of them and pumps bytes both ways. Each
 * paired socket is handed to the http.Server as a `connection`, which is how
 * Node's own cluster module feeds a server, so everything above it — routes,
 * the token check, serve()/shutdown() — is unchanged.
 *
 * The branch is chosen by the ENVIRONMENT, not by the platform: the actuator
 * decides per spawn, and a test on any OS can play the actuator.
 */

export const RELAY_HEADER_PREFIX = "BKRELAY/1 ";
const POOL_SIZE = 4;
const RETRY_MIN_MS = 200;
const RETRY_MAX_MS = 2000;

export interface RelayEnv {
  // Loopback TCP on unix, or a Windows named pipe (npipe://) ACL'd to the
  // plugin's container SID — reached with no loopback exemption.
  rendezvous: { host: string; port: number } | { path: string };
  token: string;
}

/** The relay the actuator set up for this spawn, or null. */
export function relayEnv(): RelayEnv | null {
  const raw = process.env.BRANCHKIT_LISTEN_RELAY ?? "";
  const token = process.env.BRANCHKIT_LISTEN_RELAY_TOKEN ?? "";
  if (!raw || !token) return null;
  if (raw.startsWith("npipe://")) {
    const path = raw.slice("npipe://".length);
    if (!path) return null;
    return { rendezvous: { path }, token };
  }
  const i = raw.lastIndexOf(":");
  if (i === -1) return null;
  const port = Number.parseInt(raw.slice(i + 1), 10);
  if (!Number.isFinite(port) || port <= 0) return null;
  return { rendezvous: { host: raw.slice(0, i), port }, token };
}

/** Dial the rendezvous — a Windows pipe path or a loopback host:port. */
function dialRendezvous(env: RelayEnv): Socket {
  return "path" in env.rendezvous
    ? connect(env.rendezvous.path)
    : connect(env.rendezvous.port, env.rendezvous.host);
}

/** Declared listeners as the actuator published them: `id=port,…`. */
export function grantedListeners(): { id: string; port: number }[] {
  const raw = process.env.BRANCHKIT_LISTEN_PORTS ?? "";
  const out: { id: string; port: number }[] = [];
  for (const pair of raw.split(",")) {
    const [id, p] = pair.trim().split("=");
    const port = Number.parseInt(p ?? "", 10);
    if (id && Number.isFinite(port) && port > 0) out.push({ id, port });
  }
  return out;
}

/** A handle on the pool, so shutdown can stop it. */
export interface RelayPool {
  stop(): void;
}

/**
 * Keep POOL_SIZE connections parked at the rendezvous for `listenerId`;
 * hand each one the actuator pairs to `server` as a connection.
 */
export function startRelayPool(server: Server, env: RelayEnv, listenerId: string): RelayPool {
  let stopped = false;
  const parked = new Set<Socket>();

  const park = (attempt = 0) => {
    if (stopped) return;
    const socket = dialRendezvous(env);
    parked.add(socket);
    let seen = Buffer.alloc(0);
    let paired = false;

    const retry = () => {
      parked.delete(socket);
      if (stopped || paired) return;
      const delay = Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
      setTimeout(() => park(attempt + 1), delay).unref?.();
    };

    socket.once("connect", () => {
      socket.write(`${RELAY_HEADER_PREFIX}${listenerId} ${env.token}\n`);
    });
    socket.on("data", function onData(chunk: Buffer) {
      if (paired) return;
      seen = Buffer.concat([seen, chunk]);
      if (seen.length < 3) return;
      if (seen.subarray(0, 3).toString() !== "OK\n") {
        socket.destroy();
        return;
      }
      paired = true;
      parked.delete(socket);
      socket.removeListener("data", onData);
      // The client's first bytes may share the segment with OK: put them
      // back so the HTTP parser sees them first.
      const rest = seen.subarray(3);
      if (rest.length > 0) socket.unshift(rest);
      // A replacement first, so the pool never dips while this one serves.
      park();
      server.emit("connection", socket);
    });
    socket.on("error", () => {
      /* retry below */
    });
    socket.on("close", () => {
      if (!paired) retry();
    });
  };

  for (let i = 0; i < POOL_SIZE; i++) park();
  return {
    stop() {
      stopped = true;
      for (const s of parked) s.destroy();
      parked.clear();
    },
  };
}
