import { describe, it, expect } from "bun:test";
import { Plugin } from "../plugin.js";

// Drives a parsed inbound notification through the private router, the same
// way the correlation tests do.
function route(plugin: Plugin, method: string, params: unknown = {}): void {
  (plugin as unknown as { routeMessage: (m: unknown) => void }).routeMessage({
    jsonrpc: "2.0",
    method,
    params,
  });
}

function shutdown(plugin: Plugin): void {
  (plugin as unknown as { shutdown: () => void }).shutdown();
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("onPattern", () => {
  it("delivers matching events with the concrete event type", async () => {
    const plugin = new Plugin();
    const seen: string[] = [];
    plugin.onPattern("scripts.*.*", (eventType) => {
      seen.push(eventType);
    });
    plugin.onPattern("browser.*.*", (eventType) => {
      seen.push(`browser:${eventType}`);
    });

    const running = plugin.run();
    route(plugin, "scripts.headphones.charged");
    route(plugin, "scripts.notes.saved");
    // `*` is ONE segment: neither of these matches `scripts.*.*`.
    route(plugin, "scripts.headphones");
    route(plugin, "_platform.app.focused");
    await settle();
    shutdown(plugin);
    await running;

    expect(seen).toEqual(["scripts.headphones.charged", "scripts.notes.saved"]);
  });

  it("runs exact listeners before pattern listeners", async () => {
    const plugin = new Plugin();
    const order: string[] = [];
    plugin.on("scripts.headphones.charged", () => {
      order.push("exact");
    });
    plugin.onPattern("scripts.*.*", () => {
      order.push("pattern");
    });

    const running = plugin.run();
    route(plugin, "scripts.headphones.charged");
    await settle();
    shutdown(plugin);
    await running;

    expect(order).toEqual(["exact", "pattern"]);
  });

  it("contains a throwing pattern listener", async () => {
    const plugin = new Plugin();
    let reached = false;
    plugin.onPattern("scripts.*.*", () => {
      throw new Error("boom");
    });
    plugin.onPattern("scripts.*.*", () => {
      reached = true;
    });

    const running = plugin.run();
    route(plugin, "scripts.headphones.charged");
    await settle();
    shutdown(plugin);
    await running;

    expect(reached).toBe(true);
  });
});
