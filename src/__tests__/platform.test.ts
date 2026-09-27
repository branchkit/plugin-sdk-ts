import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";

/** Deliver a notification the way the read loop does: every listener, in order. */
async function deliver(p: Plugin, method: string, params: unknown) {
  // @ts-expect-error — reaching the private listener list for a unit test
  for (const fn of p.listeners.get(method) ?? []) await fn(params);
}

const profile = {
  os: "linux",
  session: "sway",
  host: "h",
  unavailable: [{ op: "native.dock_position", reason: "platform_no_analogue" }],
  unobservable_events: [],
};

describe("platform profile", () => {
  test("on_ready's profile is kept, and seen by the plugin's own onReady", async () => {
    const p = new Plugin({ detached: true });
    let seenInOnReady: unknown = "not called";
    p.onReady(() => {
      seenInOnReady = p.platform()?.session;
    });
    expect(p.platform()).toBeNull();
    await deliver(p, "on_ready", { platform: profile });
    expect(seenInOnReady).toBe("sway");
    expect(await p.supports("native.dock_position")).toBe(false);
    expect(await p.supports("native.cpu_usage")).toBe(true);
    expect(await p.supports("vendor.never_heard_of_it")).toBe(true);
  });

  test("an old actuator's bare on_ready leaves no profile, and supports() says true", async () => {
    const p = new Plugin({ detached: true });
    await deliver(p, "on_ready", {});
    expect(p.platform()).toBeNull();
    // Detached, so the fetch rejects: the call itself will say.
    expect(await p.supports("native.dock_position")).toBe(true);
  });

  test("before on_ready, supports() fetches the profile once", async () => {
    const p = new Plugin({ detached: true });
    let fetches = 0;
    // @ts-expect-error — stubbing for unit test
    p.call = async (method: string) => {
      expect(method).toBe("platform.profile");
      fetches++;
      return profile;
    };
    expect(await p.supports("native.dock_position")).toBe(false);
    expect(await p.supports("native.cpu_usage")).toBe(true);
    expect(fetches).toBe(1);
    expect(p.platform()?.os).toBe("linux");
  });
});
