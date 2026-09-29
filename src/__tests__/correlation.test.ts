import { describe, it, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { runWithCorrelation, getCurrentCorrelation } from "../correlation.js";
import { waitFor } from "./wait.js";

interface RpcLine {
  method?: string;
  correlation_id?: string;
  id?: number;
}

function captureStdout(): { lines: RpcLine[]; restore: () => void } {
  const lines: RpcLine[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (chunk: unknown) => {
    for (const part of String(chunk).split("\n")) {
      if (!part) continue;
      try {
        lines.push(JSON.parse(part) as RpcLine);
      } catch {
        /* ignore non-JSON */
      }
    }
    return true;
  };
  return {
    lines,
    restore: () => {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    },
  };
}

// A real yield to the timer queue, so the concurrent contexts below
// genuinely interleave — this one is deliberate, not a settle.
const tick = () => new Promise((r) => setTimeout(r, 10));

// Drives a parsed inbound message through the private router.
function route(plugin: Plugin, msg: RpcLine & { jsonrpc?: string; params?: unknown }): void {
  (plugin as unknown as { routeMessage: (m: unknown) => void }).routeMessage({
    jsonrpc: "2.0",
    ...msg,
  });
}

function shutdown(plugin: Plugin): void {
  (plugin as unknown as { shutdown: () => void }).shutdown();
}

describe("ambient correlation store", () => {
  it("isolates concurrent async contexts", async () => {
    const results = await Promise.all([
      runWithCorrelation("tr_a", async () => {
        await tick();
        return getCurrentCorrelation();
      }),
      runWithCorrelation("tr_b", async () => {
        await tick();
        return getCurrentCorrelation();
      }),
      runWithCorrelation(undefined, async () => {
        await tick();
        return getCurrentCorrelation();
      }),
    ]);
    expect(results).toEqual(["tr_a", "tr_b", ""]);
  });

  it("reports empty outside any scope", () => {
    expect(getCurrentCorrelation()).toBe("");
  });
});

describe("Plugin inbound correlation", () => {
  it("exposes the inbound id and stamps outbound calls", async () => {
    const cap = captureStdout();
    try {
      const plugin = new Plugin();
      let seen = "<unset>";
      plugin.handle("do_thing", async () => {
        seen = plugin.currentCorrelation();
        plugin.notify("plugin.side_effect", { k: "v" });
        return { ok: 1 };
      });
      void plugin.run(); // resolves readiness; emits plugin.initialized

      route(plugin, { id: 1, method: "do_thing", correlation_id: "tr_inbound99" });
      // The handler has run once its side-effect notification is on the wire.
      // (Not its response: under `bun test` stdin is at EOF, so the plugin may
      // shut down — and stop writing — before the response goes out.)
      await waitFor(() => cap.lines.some((l) => l.method === "plugin.side_effect"));

      expect(seen).toBe("tr_inbound99");
      const sideEffect = cap.lines.find((l) => l.method === "plugin.side_effect");
      expect(sideEffect?.correlation_id).toBe("tr_inbound99");

      shutdown(plugin);
    } finally {
      cap.restore();
    }
  });

  it("leaves outbound unstamped when no inbound id is present", async () => {
    const cap = captureStdout();
    try {
      const plugin = new Plugin();
      let seen = "<unset>";
      plugin.handle("do_thing", async () => {
        seen = plugin.currentCorrelation();
        plugin.notify("plugin.side_effect");
        return { ok: 1 };
      });
      void plugin.run();

      route(plugin, { id: 1, method: "do_thing" });
      await waitFor(() => cap.lines.some((l) => l.method === "plugin.side_effect"));

      expect(seen).toBe("");
      const sideEffect = cap.lines.find((l) => l.method === "plugin.side_effect");
      expect(sideEffect).toBeDefined();
      expect(sideEffect?.correlation_id).toBeUndefined();

      shutdown(plugin);
    } finally {
      cap.restore();
    }
  });
});
