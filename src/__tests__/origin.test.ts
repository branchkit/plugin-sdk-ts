import { describe, it, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { type EventOrigin, getCurrentEventOrigin, runWithEventOrigin } from "../origin.js";

// Drives a parsed inbound message through the private router, the same way
// the correlation and pattern-listener tests do.
function route(plugin: Plugin, msg: Record<string, unknown>): void {
  (plugin as unknown as { routeMessage: (m: unknown) => void }).routeMessage({
    jsonrpc: "2.0",
    params: {},
    ...msg,
  });
}

function shutdown(plugin: Plugin): void {
  (plugin as unknown as { shutdown: () => void }).shutdown();
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("ambient event origin store", () => {
  it("isolates concurrent async contexts", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const results = await Promise.all([
      runWithEventOrigin({ source: "a", onBehalfOf: "" }, async () => {
        await tick();
        return getCurrentEventOrigin().source;
      }),
      runWithEventOrigin({ source: "b", onBehalfOf: "x.lua" }, async () => {
        await tick();
        return getCurrentEventOrigin().source;
      }),
    ]);
    expect(results).toEqual(["a", "b"]);
  });

  it("reports an empty origin outside any delivery", () => {
    expect(getCurrentEventOrigin()).toEqual({ source: "", onBehalfOf: "" });
  });
});

describe("Plugin.currentEventOrigin", () => {
  it("gives each listener its own delivery's sender", async () => {
    const plugin = new Plugin();
    const exact: EventOrigin[] = [];
    const patterned: EventOrigin[] = [];
    plugin.on("scripts.headphones.charged", () => {
      exact.push({ ...plugin.currentEventOrigin() });
    });
    plugin.onPattern("scripts.*.*", () => {
      patterned.push({ ...plugin.currentEventOrigin() });
    });

    const running = plugin.run();
    route(plugin, {
      method: "scripts.headphones.charged",
      source: "scripts",
      on_behalf_of: "headphones.lua",
    });
    route(plugin, { method: "scripts.headphones.charged", source: "impostor" });
    // No origin at all: an older actuator, or a notification that is not a
    // bus event. Must not inherit the previous delivery's sender.
    route(plugin, { method: "scripts.headphones.charged" });
    await settle();
    shutdown(plugin);
    await running;

    const want = [
      { source: "scripts", onBehalfOf: "headphones.lua" },
      { source: "impostor", onBehalfOf: "" },
      { source: "", onBehalfOf: "" },
    ];
    expect(exact).toEqual(want);
    expect(patterned).toEqual(want);
    expect(plugin.currentEventOrigin()).toEqual({ source: "", onBehalfOf: "" });
  });

  it("is empty inside a request handler", async () => {
    const plugin = new Plugin();
    let seen: EventOrigin | undefined;
    plugin.handle("do_thing", async () => {
      seen = { ...plugin.currentEventOrigin() };
      return {};
    });
    const running = plugin.run();
    // A request never carries a sender; even one that did is not an event.
    route(plugin, { id: 1, method: "do_thing", source: "scripts" });
    await settle();
    shutdown(plugin);
    await running;
    expect(seen).toEqual({ source: "", onBehalfOf: "" });
  });
});
