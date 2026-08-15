import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { methodURL, methodPost } from "../settings_route.js";

describe("settings route helpers", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.BRANCHKIT_PLUGIN_ID;
    process.env.BRANCHKIT_PLUGIN_ID = "windows";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BRANCHKIT_PLUGIN_ID;
    else process.env.BRANCHKIT_PLUGIN_ID = saved;
  });

  test("methodURL spells the one route shape", () => {
    expect(methodURL("set_gap")).toBe("/v1/plugins/windows/methods/set_gap");
    // Leading slash on the method must not double the separator.
    expect(methodURL("/set_gap")).toBe("/v1/plugins/windows/methods/set_gap");
  });

  test("methodURL falls back to unknown without a plugin id", () => {
    delete process.env.BRANCHKIT_PLUGIN_ID;
    expect(methodURL("reset")).toBe("/v1/plugins/unknown/methods/reset");
  });

  test("methodPost with and without payload", () => {
    expect(methodPost("reset")).toBe("@post('/v1/plugins/windows/methods/reset')");
    expect(methodPost("set_auto_tile", "{enabled: true}")).toBe(
      "@post('/v1/plugins/windows/methods/set_auto_tile', {payload: {enabled: true}})",
    );
  });
});
