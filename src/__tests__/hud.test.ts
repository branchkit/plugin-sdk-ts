import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";
import "../hud.js";

describe("hud push sugar", () => {
  test("hudPushFragment sends the morph shape", async () => {
    const p = new Plugin();
    let sent: unknown;
    // @ts-expect-error stub
    p.call = async (method: string, params: unknown) => {
      expect(method).toBe("hud.push");
      sent = params;
      return {};
    };
    await p.hudPushFragment("ch", "content", "<b>x</b>");
    expect(sent).toEqual({ channel: "ch", fragments: [{ target_id: "content", html: "<b>x</b>" }] });
  });

  test("hudPushRaw sends the raw shape", async () => {
    const p = new Plugin();
    let sent: unknown;
    // @ts-expect-error stub
    p.call = async (method: string, params: unknown) => {
      sent = params;
      return {};
    };
    await p.hudPushRaw("ch", "<div>y</div>");
    expect(sent).toEqual({ channel: "ch", fragments: [{ target_id: "", html: "<div>y</div>", raw: true }] });
  });
});
