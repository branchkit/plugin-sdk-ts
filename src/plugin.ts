import { createInterface } from "node:readline";
import { Log } from "./log.js";
import { APIVersion, HookOnAction } from "./contracts_gen.js";
import type { OnActionRequest, OnActionResponse } from "./types_gen.js";
import { runWithCorrelation, getCurrentCorrelation } from "./correlation.js";

// --- JSON-RPC 2.0 message types ---

interface RpcMessage {
  jsonrpc: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: RpcError;
  /**
   * Envelope-level correlation id (`tr_<base62>`). Lives outside `params`
   * so methods and notifies carry it uniformly. The actuator stamps
   * outbound calls from its current scope; inbound calls preserve the
   * id from the wire.
   */
  correlation_id?: string;
}

interface RpcError {
  code: number;
  message: string;
}

// --- Handler types ---

type HandlerFn = (params: unknown) => Promise<unknown>;
/**
 * A listener may be async. The ordered pump awaits whatever it returns before
 * delivering the next notification, so returning the promise is what preserves
 * wire order across an async listener — see {@link Plugin.on}.
 */
type ListenerFn = (params: unknown) => void | Promise<void>;

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

  // Inbound notifications drain through one pump so listeners observe them in
  // wire order, matching the Go SDK. See notes/DESIGN_SDK_EVENT_ORDERING.md.
  private notifyQueue: Array<{
    method: string;
    params: unknown;
    correlationId: string | undefined;
  }> = [];
  private notifyPumpActive = false;

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
   *
   * An async callback is awaited before the next notification is delivered,
   * so an on_ready fetch completes before any update event lands.
   */
  onReady(fn: () => void | Promise<void>): void {
    this.on("on_ready", () => fn());
  }

  /**
   * Register a listener for actuator→plugin notifications (fire-and-forget).
   * Multiple listeners can be registered for the same method.
   *
   * An async listener MUST return its promise (do not `void` it) — the ordered
   * pump awaits the return value, so a discarded promise opts that listener out
   * of the wire-order guarantee and lets concurrent invocations interleave.
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

      // Write the request, inheriting the ambient inbound correlation so the
      // call joins the upstream causal chain (the actuator opens a scope from
      // the envelope id for the whole RPC).
      this.write({
        jsonrpc: "2.0",
        id,
        method,
        params,
        correlation_id: getCurrentCorrelation() || undefined,
      });
    });
  }

  /**
   * Send a fire-and-forget notification to the actuator (no response expected).
   */
  notify(method: string, params?: unknown): void {
    this.write({
      jsonrpc: "2.0",
      method,
      params,
      correlation_id: getCurrentCorrelation() || undefined,
    });
  }

  /**
   * The inbound correlation id for the actuator→plugin request or notification
   * currently being handled, or "" if none is in flight. Handlers use it to
   * tie their own work back to the upstream causal chain; outbound calls
   * inherit it automatically, so most handlers never need to read it directly.
   */
  currentCorrelation(): string {
    return getCurrentCorrelation();
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
      this.handleRequest(msg.id, msg.method, msg.params, msg.correlation_id);
      return;
    }

    // Notification from actuator — has method, no id (W5: no response).
    // Enqueue for the single ordered pump so listeners run in wire order.
    if (msg.id === undefined && msg.method) {
      this.enqueueNotification(msg.method, msg.params, msg.correlation_id);
      return;
    }
  }

  private async handleRequest(
    id: number,
    method: string,
    params: unknown,
    correlationId: string | undefined,
  ): Promise<void> {
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

    // Make the inbound envelope correlation ambient for the handler (and any
    // outbound call it makes), then run with exception recovery (C3).
    await runWithCorrelation(correlationId, async () => {
      try {
        const result = await handler(params);
        this.write({ jsonrpc: "2.0", id, result: result ?? null });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        Log(this.pluginId, `handler error for ${method}: ${message}`);
        this.sendError(id, -1, message);
      }
    });
  }

  // enqueueNotification appends to the ordered queue and starts the pump if it
  // is idle. Never blocks the read loop.
  private enqueueNotification(
    method: string,
    params: unknown,
    correlationId: string | undefined,
  ): void {
    this.notifyQueue.push({ method, params, correlationId });
    if (!this.notifyPumpActive) {
      this.notifyPumpActive = true;
      void this.drainNotifications();
    }
  }

  // drainNotifications runs queued notifications one at a time, awaiting each
  // listener (and any outbound call() it makes) before the next notification —
  // so listeners observe wire order. The read loop keeps running while a
  // listener awaits, so responses still arrive; serializing cannot deadlock.
  // See notes/DESIGN_SDK_EVENT_ORDERING.md.
  private async drainNotifications(): Promise<void> {
    while (this.notifyQueue.length > 0) {
      const { method, params, correlationId } = this.notifyQueue.shift()!;
      const listeners = this.listeners.get(method);
      if (!listeners) continue;
      await runWithCorrelation(correlationId, async () => {
        for (const fn of listeners) {
          try {
            await fn(params);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            Log(this.pluginId, `listener error for ${method}: ${message}`);
          }
        }
      });
    }
    this.notifyPumpActive = false;
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
