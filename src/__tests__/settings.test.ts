import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";
import "../mirror.js";
import "../settings.js";

interface TestConfig {
  editor: string;
}

/**
 * Build a Plugin with `call` stubbed, serving `store` as the composed
 * settings read and applying overrides.apply patches to it. Mirrors the
 * Go SDK's settings_test.go fixture.
 */
function fakePlugin(store: Record<string, unknown>): {
  plugin: Plugin;
  saw: { applies: number };
} {
  const saw = { applies: 0 };
  const p = new Plugin();
  // @ts-expect-error — stubbing for unit test
  p.call = async (method: string, params: unknown) => {
    if (method === "overrides.apply") {
      const req = params as {
        action: string;
        tenant?: string;
        fields?: Record<string, unknown>;
      };
      expect(req.action).toBe("patch");
      expect(req.tenant).toBe("_user");
      Object.assign(store, req.fields);
      saw.applies++;
      return { ok: true };
    }
    if (method === "collection.get") {
      return { name: "plugin.test.config", data: store };
    }
    throw new Error(`unexpected method ${method}`);
  };
  p.on = () => {};
  return { plugin: p, saw };
}

describe("settings mirror write/read-through", () => {
  // The race this API exists to close: after setUser resolves, the very
  // next get() (the re-render the actuator triggers on method return)
  // must see the write without waiting for collection.updated.
  test("setUser is observable to an immediate get", async () => {
    const store: Record<string, unknown> = { editor: "" };
    const { plugin, saw } = fakePlugin(store);
    const s = plugin.settings<TestConfig>("plugin.test.config");

    await s.setUser("editor", "dev.zed.Zed");
    expect(saw.applies).toBe(1);
    expect(s.ready).toBe(true);
    expect(s.get()?.editor).toBe("dev.zed.Zed");
  });

  test("unpatchUser relays and refreshes", async () => {
    const store: Record<string, unknown> = { editor: "custom" };
    const p2 = new (await import("../plugin.js")).Plugin();
    let sawUnpatch = false;
    // @ts-expect-error stub
    p2.call = async (method: string, params: unknown) => {
      if (method === "overrides.apply") {
        const req = params as { action: string; field?: string; tenant?: string };
        expect(req.action).toBe("unpatch");
        expect(req.field).toBe("editor");
        expect(req.tenant).toBe("_user");
        store.editor = "";
        sawUnpatch = true;
        return { ok: true };
      }
      if (method === "collection.get") return { name: "plugin.test.config", data: store };
      throw new Error("unexpected " + method);
    };
    p2.on = () => {};
    const s2 = p2.settings<TestConfig>("plugin.test.config");
    await s2.unpatchUser("editor");
    expect(sawUnpatch).toBe(true);
    expect(s2.get()?.editor).toBe("");
  });

});

// The SDK-owned render_settings hook: one renderer per tab key, the
// registered stylesheet on every response, an error for a key nobody
// registered, and every settings mirror refreshed before the tab draws.
describe("settings tabs", () => {
  async function render(plugin: Plugin, tab_key: string): Promise<{ html: string; css?: string }> {
    // @ts-expect-error — reaching the private handler table for the test
    const fn = plugin.handlers.get("render_settings");
    expect(fn).toBeDefined();
    return (await fn!({ tab_key, search: "" })) as { html: string; css?: string };
  }

  test("dispatches by tab_key, attaches css, refreshes mirrors first", async () => {
    const store: Record<string, unknown> = { editor: "stale" };
    const { plugin } = fakePlugin(store);
    const mirror = plugin.settings<TestConfig>("plugin.test.config");
    plugin.settingsCSS(".alpha{}");
    plugin.settingsTab("alpha", () => `<p id="alpha">${mirror.get()?.editor ?? ""}</p>`);
    plugin.settingsTab("beta", async (req) => `<p id="beta">${req.tab_key}</p>`);

    // The store moved behind the mirror's back (no collection.updated);
    // the render must still see the current value.
    store.editor = "fresh";
    const alpha = await render(plugin, "alpha");
    expect(alpha.html).toBe('<p id="alpha">fresh</p>');
    expect(alpha.css).toBe(".alpha{}");

    const beta = await render(plugin, "beta");
    expect(beta.html).toBe('<p id="beta">beta</p>');

    await expect(render(plugin, "nope")).rejects.toThrow('"nope"');
  });

  test("renderer errors propagate rather than becoming an empty tab", async () => {
    const { plugin } = fakePlugin({});
    plugin.settingsTab("broken", () => {
      throw new Error("cannot draw");
    });
    await expect(render(plugin, "broken")).rejects.toThrow("cannot draw");
  });

  test("settingsTab and handle(render_settings) are mutually exclusive", () => {
    const a = fakePlugin({}).plugin;
    a.settingsTab("x", () => "");
    expect(() => a.handle("render_settings", async () => ({}))).toThrow("pick one");

    const b = fakePlugin({}).plugin;
    b.handle("render_settings", async () => ({}));
    expect(() => b.settingsTab("x", () => "")).toThrow("pick one");
  });
});


// The no-platform contract tests build hosts on: calls reject at once,
// notify and run are inert, a settings mirror can be constructed.
describe("detached plugin", () => {
  test("rejects calls, swallows notifies, run resolves", async () => {
    const p = new Plugin({ detached: true });
    await expect(p.call("collection.get", { name: "x" })).rejects.toThrow("detached plugin");
    p.notify("events.emit", { x: 1 });
    const m = p.settings<TestConfig>("plugin.test.config");
    expect(m.ready).toBe(false);
    await p.run();
  });
});
