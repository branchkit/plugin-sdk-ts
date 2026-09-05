import { describe, test, expect } from "bun:test";
import {
  command,
  word,
  oneOf,
  capture,
  text,
  pushCommandSpecs,
} from "../commands.js";
import type { Plugin } from "../plugin.js";

// The builder's job is to produce the exact wire JSON the actuator parses.
// JSON.stringify round-trips here mirror what pushCommandSpecs sends.
function wire(spec: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(spec));
}

describe("command builder", () => {
  test("oneOf produces a nested alternatives slot", () => {
    const spec = command(oneOf("refresh", "reload"))
      .action("browser.refresh")
      .requiresTags("plugin.browser.active")
      .category("Navigation")
      .build();
    const m = wire(spec);

    expect(m.pattern).toEqual([["refresh", "reload"]]);
    expect(m.action).toEqual({ type: "browser.refresh" });
    expect(m.requires_tags).toEqual(["plugin.browser.active"]);
    expect(m.category).toBe("Navigation");
  });

  test("word + capture + action params", () => {
    const spec = command(word("focus"), capture("app", "apps"))
      .action("input.focus_app", { strategy: "frontmost" })
      .build();
    const m = wire(spec);

    expect(m.pattern).toEqual(["focus", "<app:apps>"]);
    // One params dialect: the payload nests under "params", never flat.
    expect(m.action).toEqual({
      type: "input.focus_app",
      params: { strategy: "frontmost" },
    });
  });

  test("capture default name and text slots", () => {
    expect(capture("", "apps")).toBe("<apps>");
    expect(text("phrase")).toBe("<phrase:text>");
    expect(text()).toBe("<text>");
  });

  test("tag fields serialize as [] not null", () => {
    const m = wire(command(word("ping")).action("noop").build());
    expect(m.requires_tags).toEqual([]);
    expect(m.sets_tags).toEqual([]);
    expect(m.clears_tags).toEqual([]);
    expect(m.sets_on_partial).toEqual([]);
    expect(m.variants).toEqual([]);
    expect(m.cancels_bridge).toBe(false);
  });

  test("setsTags + cancelsBridge", () => {
    const m = wire(
      command(word("snap"))
        .setsTags("plugin.tiling.snap_mode")
        .cancelsBridge()
        .build(),
    );
    expect(m.sets_tags).toEqual(["plugin.tiling.snap_mode"]);
    expect(m.cancels_bridge).toBe(true);
  });

  test("pushCommandSpecs coerces null array fields to [] (Go parity)", async () => {
    let sentBody: { commands: Record<string, unknown>[] } | undefined;
    const fakePlugin = {
      call: async (_method: string, body: { commands: Record<string, unknown>[] }) => {
        sentBody = body;
        return { count: 1 };
      },
    } as unknown as Plugin;

    // A spec as loadCommands would produce from a file with explicit nulls.
    const raw = {
      pattern: ["x"],
      action: { type: "noop" },
      requires_tags: null,
      sets_tags: null,
      clears_tags: null,
      sets_on_partial: null,
      variants: null,
    } as unknown as Parameters<typeof pushCommandSpecs>[1][number];

    await pushCommandSpecs(fakePlugin, [raw]);
    const c = sentBody!.commands[0];
    expect(c.requires_tags).toEqual([]);
    expect(c.sets_tags).toEqual([]);
    expect(c.clears_tags).toEqual([]);
    expect(c.sets_on_partial).toEqual([]);
    expect(c.variants).toEqual([]);
  });
});
