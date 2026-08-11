import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "./plugin.js";

/**
 * Discovery file format written to connect.json.
 */
export interface ConnectInfo {
  port: string;
  token: string;
}

type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Listener accepts inbound HTTP connections from an external service
 * and provides access to the Plugin for forwarding data to the actuator.
 *
 * Usage:
 *
 * ```ts
 * const plugin = new Plugin();
 * const listener = await ListenLocal(plugin);
 * listener.handleFunc("POST", "/push", (req, res) => {
 *   // use plugin.call() to forward data to actuator
 * });
 * listener.serve();
 * await plugin.run();
 * listener.shutdown();
 * ```
 */
export class Listener {
  private server: Server;
  private token: string;
  private routes = new Map<string, HttpHandler>();
  private _addr: string;
  private serving = false;
  readonly plugin: Plugin;

  /** @internal — use ListenLocal() to create */
  constructor(server: Server, token: string, addr: string, plugin: Plugin) {
    this.server = server;
    this.token = token;
    this._addr = addr;
    this.plugin = plugin;
  }

  /**
   * Register an HTTP handler for an exact method + path.
   *
   * Matching is on the path only — a query string on the request is ignored,
   * so `POST /push` also serves `POST /push?since=12`.
   *
   * Narrower than the Go SDK, which hands the pattern to `http.ServeMux` and
   * therefore also supports wildcards (`/item/{id}`) and trailing-slash subtree
   * matches. Register each concrete path here, or read the params off
   * `req.url` yourself.
   */
  handleFunc(method: string, path: string, handler: HttpHandler): void {
    this.routes.set(`${method} ${path}`, handler);
  }

  /** The listener's address (e.g. "127.0.0.1:52431"). */
  addr(): string {
    return this._addr;
  }

  /** The pairing token that external services must present. */
  getToken(): string {
    return this.token;
  }

  /**
   * Begin dispatching to registered handlers. Non-blocking (unlike Go's Serve,
   * which blocks until shutdown).
   *
   * The socket is already bound and accepting when ListenLocal resolves — Node
   * cannot separate bind from accept the way Go's net.Listen + Serve can, and
   * the port has to be known to write connect.json. So rather than accept
   * silently into an empty route table, requests arriving before serve() get a
   * 503. Without that they drew a 404, which is indistinguishable from a
   * genuinely wrong path and sent callers hunting the wrong bug.
   */
  serve(): void {
    this.serving = true;
  }

  /** Gracefully stop the listener and remove the discovery file. */
  shutdown(): void {
    this.server.close();
    // close() alone stops new connections but waits on idle keep-alive
    // sockets, which can hang process exit. Go's Shutdown(ctx) bounds this
    // with the caller's deadline; Node needs the explicit sweep.
    this.server.closeAllConnections?.();
    removeDiscovery();
  }

  /** @internal — dispatch incoming requests */
  _dispatch(req: IncomingMessage, res: ServerResponse): void {
    // Validate pairing token
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) {
      res.writeHead(401);
      res.end("unauthorized");
      return;
    }
    if (auth.slice(7) !== this.token) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    if (!this.serving) {
      res.writeHead(503);
      res.end("listener not serving yet");
      return;
    }

    // Match on the path alone: req.url carries the query string, so keying the
    // route table on it made `POST /push?x=1` miss a `POST /push` route. Go's
    // ServeMux matches on path, so the same plugin worked there and 404'd here.
    const url = req.url ?? "";
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);

    const handler = this.routes.get(`${req.method} ${path}`);
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  }
}

/**
 * Number of actuator-granted listener sockets (manifest `sockets.listen`,
 * delivered per the LISTEN_FDS convention at fds 3+). 0 when none were
 * granted — old actuators, unsandboxed dev runs, or no manifest
 * declaration. Unlike systemd's convention, LISTEN_PID is deliberately
 * not set or checked: the actuator cannot know the child pid before
 * spawn, and plugin identity is already established by fd ownership.
 */
export function inheritedListenerCount(): number {
  const n = Number.parseInt(process.env.LISTEN_FDS ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Bind a localhost TCP port for an external service to connect to.
 * Generates a pairing token and writes a connect.json discovery file
 * to BRANCHKIT_PLUGIN_DIR so the external service can find the port and token.
 *
 * When the actuator granted listener sockets (manifest `sockets.listen`),
 * the FIRST granted listener (fd 3) is used instead of self-binding.
 * This is not an optimization: inside the Linux sandbox the plugin runs
 * in an empty network namespace, where a self-bound "127.0.0.1" is a
 * private dead loopback — the inherited host-loopback listener is the
 * only reachable surface. See the actuator's
 * notes/DESIGN_SANDBOX_LOOPBACK_FDPASS.md.
 */
export function ListenLocal(plugin: Plugin): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const token = randomBytes(32).toString("hex");

    const server = createServer();
    const usingInherited = inheritedListenerCount() > 0;

    // onListening runs as an async callback, OUTSIDE the executor's synchronous
    // frame — so a throw in there does not reject this promise, it becomes an
    // uncaughtException while the caller awaits forever. Route every settle
    // through these two so that cannot happen, and so a late `error` event
    // can't reject after we've already resolved.
    let settled = false;
    const settleOk = (l: Listener) => {
      if (settled) return;
      settled = true;
      resolve(l);
    };
    const settleErr = (err: Error) => {
      if (settled) return;
      settled = true;
      server.close();
      reject(err);
    };

    const onListening = () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        settleErr(new Error("failed to get listener address"));
        return;
      }

      // Tripwire for runtimes that accept listen({fd}) but silently bind a
      // fresh socket instead (Bun's node:http does exactly this): when the
      // actuator published the granted ports, serving anywhere else means
      // the inherited listener was dropped on the floor — inside the
      // sandbox that is a dead private loopback, so fail loudly.
      if (usingInherited) {
        const granted = grantedPorts();
        if (granted.length > 0 && !granted.includes(address.port)) {
          settleErr(
            new Error(
              `runtime silently rebound the inherited listener ` +
                `(serving :${address.port}, granted :${granted.join(", :")})`,
            ),
          );
          return;
        }
      }

      const addr = `127.0.0.1:${address.port}`;
      const listener = new Listener(server, token, addr, plugin);

      server.on("request", (req, res) => {
        listener._dispatch(req, res);
      });

      // A failed discovery write is fatal, not cosmetic: the external service
      // finds the port and token ONLY through connect.json, so a listener
      // without one is unreachable. Go closes the listener and returns the
      // error (listen.go); match that instead of throwing into the void.
      try {
        writeDiscovery({ port: String(address.port), token });
      } catch (err: unknown) {
        settleErr(
          new Error(
            `failed to write connect.json discovery file: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
        return;
      }

      settleOk(listener);
    };

    if (usingInherited) {
      // Bun cannot serve an inherited fd: node:net's listen({fd}) throws
      // "Bun does not support listening on a file descriptor" (explicit in
      // Bun's src/runtime/socket/Listener.rs), Bun.listen likewise,
      // Bun.serve ignores an fd option, node:http's listen({fd}) SILENTLY
      // self-binds a fresh ephemeral port, and even net.Socket({fd}) on a
      // connected socket is a silent dead socket — so no FFI accept-loop
      // workaround exists either (all measured on Bun 1.3.14; upstream
      // tracker: oven-sh/bun#22559, systemd socket activation, open).
      // A silent self-bind inside the sandbox serves a dead private
      // loopback, so refuse loudly — a TS plugin declaring sockets.listen
      // must run under Node until Bun grows fd support.
      if (process.versions.bun) {
        settleErr(
          new Error(
            "sockets.listen granted, but the Bun runtime cannot serve an inherited " +
              "listener fd (no listen({fd}) support as of Bun 1.3; node:http silently " +
              "rebinds). Run this plugin under Node, or drop the sockets.listen declaration.",
          ),
        );
        return;
      }
      server.listen({ fd: 3 }, onListening);
    } else {
      server.listen(0, "127.0.0.1", onListening);
    }

    server.on("error", (err) => {
      settleErr(err);
    });
  });
}

/**
 * Ports of the actuator-granted listeners, parsed from
 * BRANCHKIT_LISTEN_PORTS ("id=port" pairs, comma-separated). Empty when
 * the actuator didn't publish them (old actuator / none granted).
 */
function grantedPorts(): number[] {
  const raw = process.env.BRANCHKIT_LISTEN_PORTS ?? "";
  return raw
    .split(",")
    .map((pair) => Number.parseInt(pair.split("=")[1] ?? "", 10))
    .filter((p) => Number.isFinite(p) && p > 0);
}

function writeDiscovery(info: ConnectInfo): void {
  const pluginDir = process.env.BRANCHKIT_PLUGIN_DIR;
  if (!pluginDir) return;

  const path = join(pluginDir, "connect.json");
  writeFileSync(path, JSON.stringify(info, null, 2), { mode: 0o600 });
}

function removeDiscovery(): void {
  const pluginDir = process.env.BRANCHKIT_PLUGIN_DIR;
  if (!pluginDir) return;

  try {
    unlinkSync(join(pluginDir, "connect.json"));
  } catch {
    // ignore — file may not exist
  }
}
