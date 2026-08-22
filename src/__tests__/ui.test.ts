import { describe, test, expect } from "bun:test";
import { postButton, signalButton, confirmButton, expr, inputValue, signalName } from "../ui.js";

describe("settings ui helpers", () => {
  test("postButton escapes and routes", () => {
    const h = postButton("Save <x>", "set_thing", { payload: { v: 1 }, style: "font-size:12px;" });
    expect(h).toContain("Save &lt;x&gt;");
    expect(h).toContain("/methods/set_thing");
  });

  test("payload marshals values — quotes stay data", () => {
    const h = postButton("Save", "rename", { payload: { name: "it's", n: 3, ok: true } });
    expect(h).toContain("&quot;name&quot;:&quot;it&#39;s&quot;");
    expect(h).toContain("&quot;n&quot;:3");
  });

  test("Expr embeds raw; el not $el", () => {
    const h = postButton("Save", "rename", { payload: { new_name: inputValue } });
    expect(h).toContain("el.previousElementSibling.value");
    expect(h).not.toContain("$el");
  });

  test("then composes outside the payload", () => {
    const h = postButton("Save", "rename", { payload: { name: "x" }, then: "$r = false" });
    expect(h).toContain("}); $r = false");
  });

  test("confirmButton contract", () => {
    const h = confirmButton("Delete", "delete_thing", { payload: { id: "x" } });
    expect(h).toContain("__ifmissing");
    expect(h).toContain("; $c_");
    expect(h).toContain(">Really delete?<");
    expect(h).toContain(">Cancel<");
    const h2 = confirmButton("Delete", "delete_thing", { payload: { id: "x" } });
    const h3 = confirmButton("Delete", "delete_thing", { payload: { id: "y" } });
    const keyOf = (s: string) => s.slice(s.indexOf("c_"), s.indexOf("__ifmissing"));
    expect(keyOf(h)).toBe(keyOf(h2));
    expect(keyOf(h)).not.toBe(keyOf(h3));
  });

  test("class and style emitted", () => {
    const h = signalButton("Rename", "$r = true", { class: "btn-sm", style: "margin:0;" });
    expect(h).toContain('class="btn-sm"');
    expect(h).toContain('style="margin:0;"');
  });

  test("signalName sanitizes and disambiguates", () => {
    expect(signalName("my.file")).not.toBe(signalName("my file"));
    expect(/^[a-zA-Z0-9_]+$/.test(signalName("a b.c"))).toBe(true);
  });

  test("expr helper wraps raw js", () => {
    const h = postButton("T", "m", { payload: { v: expr("$sig") } });
    expect(h).toContain("&quot;v&quot;:$sig");
  });
});
