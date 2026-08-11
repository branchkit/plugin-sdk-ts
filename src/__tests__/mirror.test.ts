import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";
import "../mirror.js";

/**
 * Build a Plugin with `call` stubbed and `on`/`onReady` intercepted so
 * tests can fire the mirror's freshness hooks deterministically.
 */
function fakePlugin(respond: (method: string, params: unknown) => unknown): {
  plugin: Plugin;
  fire: (method: string, params?: unknown) => Promise<void>;
} {
  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const p = new Plugin();
  // @ts-expect-error — stubbing for unit test
  p.call = async (method: string, params: unknown) => {
    const result = respond(method, params);
    if (result instanceof Error) throw result;
    return result;
  };
  p.on = (method: string, fn: (params: unknown) => void) => {
    const list = listeners.get(method) ?? [];
    list.push(fn);
    listeners.set(method, list);
  };
  const fire = async (method: string, params: unknown = {}) => {
    for (const fn of listeners.get(method) ?? []) {
      fn(params);
    }
    // Let the mirror's async refresh settle.
    await new Promise((r) => setTimeout(r, 0));
  };
  return { plugin: p, fire };
}

describe("collection mirror", () => {
  test("refresh populates snapshot and fires onChange", async () => {
    const { plugin } = fakePlugin((method) => {
      expect(method).toBe("collection.get");
      return {
        name: "alphabet",
        introducer: "voice",
        merge: "authoritative",
        data: [{ letter: "a", codeword: "arch" }],
      };
    });
    const mirror = plugin.mirrorCollection("alphabet");
    let changes = 0;
    mirror.onChange(() => changes++);

    expect(mirror.ready).toBe(false);
    await mirror.refresh();
    expect(mirror.ready).toBe(true);
    expect(mirror.raw()).toEqual([{ letter: "a", codeword: "arch" }]);
    expect(changes).toBe(1);
  });

  test("unpopulated sentinel stays not-ready without error", async () => {
    // The boot race: collection.get before the owner's first Put
    // returns the empty-array sentinel.
    const { plugin } = fakePlugin(() => ({
      name: "layout_characters",
      introducer: "keyboard",
      merge: "authoritative",
      data: [],
    }));
    const mirror = plugin.mirrorCollection("layout_characters");
    let changes = 0;
    mirror.onChange(() => changes++);

    await mirror.refresh();
    expect(mirror.ready).toBe(false);
    expect(mirror.raw()).toBeNull();
    expect(changes).toBe(0);
  });

  test("RPC error rejects and preserves snapshot", async () => {
    let fail = false;
    const { plugin } = fakePlugin(() =>
      fail
        ? new Error("backend down")
        : { name: "alphabet", introducer: "voice", merge: "authoritative", data: { k: "v1" } },
    );
    const mirror = plugin.mirrorCollection("alphabet");
    await mirror.refresh();
    fail = true;
    await expect(mirror.refresh()).rejects.toThrow("backend down");
    expect(mirror.raw()).toEqual({ k: "v1" });
    expect(mirror.ready).toBe(true);
  });

  // Drives the REAL notification pump (not fakePlugin's stubbed `on`), because
  // the thing under test IS the pump's await. Inverted latency is the
  // discriminator: the FIRST update's fetch is slow, the SECOND's is instant.
  //
  //   serialized (correct): get#1 completes → v1, then get#2 → v2. Final = v2.
  //   concurrent (the bug): both in flight; get#2 resolves first and writes v2,
  //                         then the stale get#1 resolves and clobbers it → v1.
  //
  // So a regression flips the final snapshot back to v1.
  test("rapid updates refresh in wire order, not completion order", async () => {
    const p = new Plugin();
    let get = 0;
    // @ts-expect-error — stubbing transport for unit test
    p.call = async (method: string) => {
      expect(method).toBe("collection.get");
      get++;
      const version = `v${get}`;
      // First fetch is slow, second is instant.
      await new Promise((r) => setTimeout(r, get === 1 ? 50 : 0));
      return { name: "alphabet", introducer: "voice", merge: "authoritative", data: { k: version } };
    };

    const mirror = p.mirrorCollection("alphabet");

    // Two updates land back-to-back, as a burst of owner writes produces.
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("_platform.collection.updated", { collection: "alphabet" });
    // @ts-expect-error
    p.enqueueNotification("_platform.collection.updated", { collection: "alphabet" });

    await new Promise((r) => setTimeout(r, 200));

    expect(get).toBe(2);
    expect(mirror.raw()).toEqual({ k: "v2" });
  });

  test("on_ready fetches; matching update refetches; non-matching ignored", async () => {
    let version = "v1";
    let gets = 0;
    const { plugin, fire } = fakePlugin(() => {
      gets++;
      return {
        name: "alphabet",
        introducer: "voice",
        merge: "authoritative",
        data: { k: version },
      };
    });
    const mirror = plugin.mirrorCollection("alphabet");

    await fire("on_ready");
    expect(mirror.raw()).toEqual({ k: "v1" });

    version = "v2";
    await fire("_platform.collection.updated", { collection: "other" });
    expect(mirror.raw()).toEqual({ k: "v1" });

    await fire("_platform.collection.updated", { collection: "alphabet" });
    expect(mirror.raw()).toEqual({ k: "v2" });
    expect(gets).toBe(2);
  });
});
