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

  test("load reads through to the store's current state", async () => {
    const store: Record<string, unknown> = { editor: "stale" };
    const { plugin } = fakePlugin(store);
    const s = plugin.settings<TestConfig>("plugin.test.config");

    store.editor = "fresh-behind-the-mirrors-back";
    const got = await s.load();
    expect(got?.editor).toBe("fresh-behind-the-mirrors-back");
  });
});
