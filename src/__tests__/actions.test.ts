import { describe, it, expect } from "bun:test";
import { Plugin, type ActionRequest } from "../plugin.js";
import { HookOnAction } from "../contracts_gen.js";
import type { OnActionResponse } from "../types_gen.js";

// Drives the SDK's installed on_action handler directly, bypassing stdio.
// `Plugin` exposes the registered handlers via its handle() registration,
// but the map itself is private — we invoke through the dispatcher by
// fishing the handler out with a synthetic re-handle and checking semantics
// through observable side effects.
//
// For these tests we instead use the documented behavior: handleAction
// registers an on_action handler internally. We can verify by re-registering
// and using the public `handle` map indirectly through .registeredActionTypes()
// and by spying on side effects.

describe("handleAction", () => {
  it("dispatches by action type with typed params", async () => {
    const plugin = new Plugin();
    let seen: { position?: string } = {};

    plugin.handleAction<{ position: string }>("wm.snap", async (req) => {
      seen.position = req.params.position;
    });

    // Drive the internal dispatcher via the registered on_action handler.
    const onAction = (plugin as unknown as { handlers: Map<string, (p: unknown) => Promise<unknown>> })
      .handlers.get(HookOnAction)!;
    const result = (await onAction({
      action: "wm.snap",
      params: { position: "left" },
    })) as OnActionResponse;

    expect(seen.position).toBe("left");
    expect(result.status).toBe("ok");
  });

  it("returns not_handled for unknown actions when no fallback is set", async () => {
    const plugin = new Plugin();
    plugin.handleAction("wm.snap", async () => {});

    const onAction = (plugin as unknown as { handlers: Map<string, (p: unknown) => Promise<unknown>> })
      .handlers.get(HookOnAction)!;
    const result = (await onAction({ action: "wm.unknown", params: {} })) as OnActionResponse;

    expect(result.status).toBe("not_handled");
  });

  // Mutual exclusion is enforced regardless of registration order — both
  // handle and handleAction install a handler for the same RPC method
  // (on_action), so allowing both would silently clobber the dispatcher.

  it("throws when handleAction is registered after handle(\"on_action\", ...)", () => {
    const plugin = new Plugin();
    plugin.handle(HookOnAction, async () => ({ status: "ok" } as OnActionResponse));
    expect(() => {
      plugin.handleAction("wm.snap", async () => {});
    }).toThrow(/cannot mix/);
  });

  it("throws when handle(\"on_action\", ...) is registered after handleAction", () => {
    const plugin = new Plugin();
    plugin.handleAction("wm.snap", async () => {});
    expect(() => {
      plugin.handle(HookOnAction, async () => ({ status: "ok" } as OnActionResponse));
    }).toThrow(/cannot mix/);
  });

  it("propagates active_app and active_window_id context", async () => {
    const plugin = new Plugin();
    let seenApp: string | undefined;
    let seenWindow: string | undefined;

    plugin.handleAction("wm.snap", async (req) => {
      seenApp = req.active_app;
      seenWindow = req.active_window_id;
    });

    const onAction = (plugin as unknown as { handlers: Map<string, (p: unknown) => Promise<unknown>> })
      .handlers.get(HookOnAction)!;
    await onAction({
      action: "wm.snap",
      active_app: "com.apple.Safari",
      active_window_id: "window-42",
      params: {},
    });

    expect(seenApp).toBe("com.apple.Safari");
    expect(seenWindow).toBe("window-42");
  });

  it("passes through OnActionResponse return value verbatim", async () => {
    const plugin = new Plugin();
    plugin.handleAction("voice.say", async () => {
      const resp: OnActionResponse = { status: "ok", control_message: "hello" };
      return resp;
    });

    const onAction = (plugin as unknown as { handlers: Map<string, (p: unknown) => Promise<unknown>> })
      .handlers.get(HookOnAction)!;
    const result = (await onAction({ action: "voice.say", params: {} })) as OnActionResponse;

    expect(result.status).toBe("ok");
    expect(result.control_message).toBe("hello");
  });

  it("registeredActionTypes() lists the registered actions", () => {
    const plugin = new Plugin();
    expect(plugin.registeredActionTypes()).toBeNull();

    plugin.handleAction("wm.snap", async () => {});
    plugin.handleAction("wm.focus", async () => {});

    const types = plugin.registeredActionTypes();
    expect(types).not.toBeNull();
    expect(new Set(types!)).toEqual(new Set(["wm.snap", "wm.focus"]));
  });

  it("translates thrown errors into rejected promises", async () => {
    const plugin = new Plugin();
    plugin.handleAction("wm.snap", async () => {
      throw new Error("snap failed");
    });

    const onAction = (plugin as unknown as { handlers: Map<string, (p: unknown) => Promise<unknown>> })
      .handlers.get(HookOnAction)!;

    await expect(onAction({ action: "wm.snap", params: {} })).rejects.toThrow("snap failed");
  });
});

describe("ActionRequest typing", () => {
  it("compiles with explicit generic", () => {
    interface SnapParams {
      position: "left" | "right";
    }
    // Type-only check — body doesn't matter, this is verified at compile.
    const _check: (req: ActionRequest<SnapParams>) => void = (req) => {
      const _: "left" | "right" = req.params.position;
    };
    expect(_check).toBeDefined();
  });
});
