import { describe, test, expect } from "bun:test";
import { postButton, postButtonThen, signalButton, confirmPostButton, inputValue, signalName } from "../ui.js";

describe("settings ui helpers", () => {
  test("postButton uses the method route and escapes the label", () => {
    const h = postButton("Save <x>", "set_thing", "{v: 1}", "font-size:12px;");
    expect(h).toContain("Save &lt;x&gt;");
    expect(h).toContain("/methods/set_thing");
  });

  test("inputValue references the element, not a signal", () => {
    expect(inputValue.startsWith("el.")).toBe(true);
    expect(inputValue.startsWith("$")).toBe(false);
  });

  test("confirm consumes its own signal", () => {
    const h = confirmPostButton("k1", "Delete", "Really?", "delete_thing", "{id: 'x'}", "");
    expect(h).toContain("data-signals:c_k1__ifmissing");
    expect(h).toContain("; $c_k1 = false");
    expect(h).toContain('data-show="!$c_k1"');
    expect(h).toContain(">Cancel<");
  });

  test("signalName sanitizes and disambiguates", () => {
    const a = signalName("my.file");
    const b = signalName("my file");
    expect(a).not.toBe(b);
    expect(/^[a-zA-Z0-9_]+$/.test(a)).toBe(true);
  });

  test("postButtonThen composes outside the payload", () => {
    const h = postButtonThen("Save", "rename", "{name: 'x'}", "$r = false", "");
    expect(h).toContain("}); $r = false");
  });

  test("signalButton emits the expression", () => {
    const h = signalButton("Rename", "$r_x = true", "");
    expect(h).toContain("$r_x = true");
  });
});
