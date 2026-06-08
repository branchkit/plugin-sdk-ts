import { describe, test, expect } from "bun:test";
import { command, word, oneOf, capture, text } from "../commands.js";

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
    expect(m.action).toEqual({ type: "input.focus_app", strategy: "frontmost" });
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
});
