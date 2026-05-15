import { createInterface } from "node:readline";
import { Log } from "./log.js";
import { APIVersion, HookOnAction } from "./contracts_gen.js";
import type { OnActionRequest, OnActionResponse } from "./types_gen.js";

// --- JSON-RPC 2.0 message types ---

interface RpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RpcError;
}

interface RpcError {
  code: number;
  message: string;
}

// --- Handler types ---

type HandlerFn = (params: unknown) => Promise<unknown>;
type ListenerFn = (params: unknown) => void;

/**
 * A typed on_action request where the params field is narrowed to T.
 * Use with handleAction&lt;T&gt;(action, fn) for compile-time typed params.
 */
export interface ActionRequest<T = unknown> {
  action: string;
  active_app?: string;
  active_window_id?: string;
  params: T;
}

/**
 * Per-action handler. Returning undefined/null is shorthand for
 * `{ status: "ok" }`. Returning an OnActionResponse passes it through.
 * Any other return is sent back as the JSON-RPC result verbatim.
 */
export type ActionHandlerFn<T = unknown> = (
  req: ActionRequest<T>,
) => Promise<unknown> | unknown;

// --- Pending call tracking ---

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// --- RPC call error ---

export class RpcCallError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "RpcCallError";
  }
}

// --- Plugin class ---

/**
 * Manages bidirectional JSON-RPC 2.0 communication over stdin/stdout.
 *
 * Handle() and on() must be called before run(). call() may be called
 * from any async context concurrently with run().
 */
export class Plugin {
  private pluginId: string;
  private handlers = new Map<string, HandlerFn>();
  private listeners = new Map<string, ListenerFn[]>();
  private pending = new Map<number, PendingCall>();
  // Lazily initialized when handleAction is first called.
  private actionHandlers: Map<string, ActionHandlerFn> | null = null;
  private nextId = 1;
  private closed = false;
  private onSignal!: () => void;
  private shutdownPromise: Promise<void>;
  private shutdownResolve!: () => void;
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;

  constructor() {
    this.pluginId = process.env.BRANCHKIT_PLUGIN_ID ?? "unknown";

    this.shutdownPromise = new Promise((resolve) => {
      this.shutdownResolve = resolve;
    });

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Handle SIGTERM/SIGINT gracefully (L3)
    this.onSignal = () => {
      Log(this.pluginId, "shutting down (signal)");
      this.shutdown();
    };
    process.on("SIGTERM", this.onSignal);
    process.on("SIGINT", this.onSignal);

    // Built-in introspection: the actuator calls list_action_types after the
    // plugin reaches readiness to validate that handlers match the manifest's
    // `action_types` block. Registering here keeps plugins from having to
    // wire it themselves.
    this.handlers.set("list_action_types", async () => ({
      action_types: this.registeredActionTypes() ?? [],
    }));

    Log(this.pluginId, "started (JSON-RPC over stdio)");
    this.startReadLoop();
  }

  /**
   * Register a handler for actuator→plugin requests.
   * The handler receives params and returns a result (serialized as JSON) or throws.
   *
   * handle("on_action", ...) and handleAction(...) are mutually exclusive —
   * both install a handler for the same RPC method. Calling either after the
   * other has been registered throws, regardless of order.
   */
  handle(method: string, fn: HandlerFn): void {
    if (method === HookOnAction && this.actionHandlers !== null) {
      throw new Error(
        'plugin-sdk-ts: cannot mix handle("on_action", ...) and handleAction(...) — pick one',
      );
    }
    this.handlers.set(method, fn);
  }

  /**
   * Register a handler for a single dispatched action type
   * (e.g. "foo.snap", "bar.start"). The SDK installs an internal
   * on_action handler that demuxes by req.action.
   *
   * handleAction is the only supported way to register action handlers.
   * Calling handle("on_action", ...) directly is reserved for plugins with
   * dynamic dispatch needs (e.g. a plugin that forwards every prefix.*
   * action to external clients) — but mixing the two will throw, since each is
   * installing the same handler key.
   *
   * Generic param T provides compile-time typing for req.params:
   *
   *     plugin.handleAction<{ position: string }>("foo.snap", async (req) =&gt; {
   *       console.log(req.params.position);
   *     });
   *
   * Return value semantics:
   *   - return undefined / null → OnActionResponse{status: "ok"}
   *   - return an OnActionResponse-shaped object → returned verbatim
   *   - return any other value → marshaled as the JSON-RPC result
   *   - throw → translated to a JSON-RPC error response
   */
  handleAction<T = unknown>(action: string, fn: ActionHandlerFn<T>): void {
    if (this.actionHandlers === null) {
      if (this.handlers.has(HookOnAction)) {
        throw new Error(
          'plugin-sdk-ts: cannot mix handle("on_action", ...) and handleAction(...) — pick one',
        );
      }
      this.actionHandlers = new Map();
      this.handlers.set(HookOnAction, (params) => this.dispatchAction(params));
    }
    this.actionHandlers.set(action, fn as ActionHandlerFn);
  }

  /**
   * Returns the list of action types registered via handleAction.
   * Useful for the (future) list_action_types RPC and for tests.
   * Returns null if no per-action handlers have been registered.
   */
  registeredActionTypes(): string[] | null {
    if (this.actionHandlers === null) return null;
    return Array.from(this.actionHandlers.keys());
  }

  private async dispatchAction(params: unknown): Promise<unknown> {
    const req = (params ?? {}) as OnActionRequest;
    const handler = this.actionHandlers?.get(req.action);
    if (handler) {
      const result = await handler(req as ActionRequest);
      if (result === undefined || result === null) {
        const ok: OnActionResponse = { status: "ok" };
        return ok;
      }
      return result;
    }
    const notHandled: OnActionResponse = { status: "not_handled" };
    return notHandled;
  }

  /**
   * Register a callback that fires when all plugins are ready.
   * The actuator sends on_ready after every plugin has called run().
   * This is the safe place to read other plugins' collections.
   * Must be called before run().
   */
  onReady(fn: () => void): void {
    this.on("on_ready", () => fn());
  }

  /**
   * Register a listener for actuator→plugin notifications (fire-and-forget).
   * Multiple listeners can be registered for the same method.
   */
  on(method: string, fn: ListenerFn): void {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  /**
   * Send a request to the actuator and wait for a response.
   * Default timeout: 10s (T1). Override with timeoutMs (T3).
   */
  call<T = unknown>(method: string, params?: unknown, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.closed) {
        reject(new Error("plugin shutting down"));
        return;
      }

      const id = this.nextId++;

      // Timeout handler (T1, T2)
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      // Write the request
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  /**
   * Send a fire-and-forget notification to the actuator (no response expected).
   */
  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  /**
   * Signal that all handlers are registered and block until shutdown.
   * Incoming requests are held until run() is called (L4).
   */
  async run(): Promise<void> {
    this.readyResolve();
    this.notify("plugin.initialized");
    await this.shutdownPromise;
  }

  // --- Internal ---

  private write(msg: RpcMessage): void {
    if (this.closed) return;
    // JSON.stringify never produces embedded newlines for non-string values,
    // and escapes \n inside strings (W9). Add trailing \n for NDJSON (W2).
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  private shutdown(): void {
    if (this.closed) return;
    this.closed = true;

    // Remove signal listeners and close readline so the process can exit naturally
    process.off("SIGTERM", this.onSignal);
    process.off("SIGINT", this.onSignal);
    this.rl?.close();
    this.rl = null;

    // Reject all pending calls (L2)
    for (const [id, pc] of this.pending) {
      clearTimeout(pc.timer);
      pc.reject(new Error("plugin shutting down"));
    }
    this.pending.clear();

    this.shutdownResolve();
  }

  private rl: ReturnType<typeof createInterface> | null = null;

  private startReadLoop(): void {
    this.rl = createInterface({
      input: process.stdin,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line: string) => {
      if (line.length === 0) return;

      let msg: RpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        Log(this.pluginId, `failed to parse message: ${line.slice(0, 200)}`);
        return;
      }

      this.routeMessage(msg);
    });

    // Exit when stdin closes (L1)
    this.rl.on("close", () => {
      Log(this.pluginId, "stdin closed, exiting");
      this.shutdown();
    });
  }

  // Routes one parsed inbound message — response, request, or notification.
  // Named `routeMessage` (not `dispatch`) because `dispatch` is the public
  // generated RPC method that calls the actuator's dispatch endpoint
  // (see methods_gen.ts) and would otherwise collide on Plugin.prototype.
  private routeMessage(msg: RpcMessage): void {
    // Response to a pending call — has id + (result or error), no method
    if (msg.id !== undefined && !msg.method) {
      const pc = this.pending.get(msg.id);
      if (pc) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pc.reject(new RpcCallError(msg.error.code, msg.error.message));
        } else {
          pc.resolve(msg.result);
        }
      }
      return;
    }

    // Request from actuator — has id + method
    if (msg.id !== undefined && msg.method) {
      // Fire async — don't block the read loop (C1)
      this.handleRequest(msg.id, msg.method, msg.params);
      return;
    }

    // Notification from actuator — has method, no id (W5: no response)
    if (msg.id === undefined && msg.method) {
      this.handleNotification(msg.method, msg.params);
      return;
    }
  }

  private async handleRequest(id: number, method: string, params: unknown): Promise<void> {
    // Wait for handlers to be registered (run() called) or shutdown (L4)
    await Promise.race([this.readyPromise, this.shutdownPromise]);

    if (this.closed) {
      this.sendError(id, -1, "plugin shutting down");
      return;
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      this.sendError(id, -32601, `method not found: ${method}`);
      return;
    }

    // Run handler with exception recovery (C3)
    try {
      const result = await handler(params);
      this.write({ jsonrpc: "2.0", id, result: result ?? null });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      Log(this.pluginId, `handler error for ${method}: ${message}`);
      this.sendError(id, -1, message);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const listeners = this.listeners.get(method);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn(params);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Log(this.pluginId, `listener error for ${method}: ${message}`);
      }
    }
  }

  private sendError(id: number, code: number, message: string): void {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }
}

/**
 * Returns the BranchKit API version from the actuator (env var),
 * falling back to the version this SDK was compiled against.
 */
export function apiVersion(): string {
  return process.env.BRANCHKIT_API_VERSION ?? APIVersion;
}

export { Log } from "./log.js";
