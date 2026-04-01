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
  readonly plugin: Plugin;

  /** @internal — use ListenLocal() to create */
  constructor(server: Server, token: string, addr: string, plugin: Plugin) {
    this.server = server;
    this.token = token;
    this._addr = addr;
    this.plugin = plugin;
  }

  /**
   * Register an HTTP handler.
   * Pattern is "METHOD /path" (e.g. "POST /push", "GET /status").
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

  /** Start accepting connections. Non-blocking (unlike Go's Serve). */
  serve(): void {
    // Already listening from ListenLocal
  }

  /** Gracefully stop the listener and remove the discovery file. */
  shutdown(): void {
    this.server.close();
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

    const key = `${req.method} ${req.url}`;
    const handler = this.routes.get(key);
    if (handler) {
      handler(req, res);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  }
}

/**
 * Bind a localhost TCP port for an external service to connect to.
 * Generates a pairing token and writes a connect.json discovery file
 * to BRANCHKIT_PLUGIN_DIR so the external service can find the port and token.
 */
export function ListenLocal(plugin: Plugin): Promise<Listener> {
  return new Promise((resolve, reject) => {
    const token = randomBytes(32).toString("hex");

    const server = createServer();

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to get listener address"));
        return;
      }

      const addr = `127.0.0.1:${address.port}`;
      const listener = new Listener(server, token, addr, plugin);

      server.on("request", (req, res) => {
        listener._dispatch(req, res);
      });

      writeDiscovery({ port: String(address.port), token });
      resolve(listener);
    });

    server.on("error", (err) => {
      reject(err);
    });
  });
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
