import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";
import { sayAction, dispatchAction } from "../output.js";
import { OutputKindChoices, OutputUrgencyAmbient, KnownOutputKinds } from "../closed_vocab_gen.js";
import type { OutputState } from "../types_gen.js";

describe("semantic output helpers", () => {
  test("sayAction is the say shape", () => {
    expect(sayAction("snap left")).toEqual({ say: "snap left" });
  });

  test("dispatchAction carries params only when given", () => {
    expect(dispatchAction("windows.desk", { n: 2 })).toEqual({ dispatch: "windows.desk", params: { n: 2 } });
    expect(dispatchAction("windows.close")).toEqual({ dispatch: "windows.close" });
    // `params` must be ABSENT, not undefined-valued, so JSON carries no key.
    expect(JSON.stringify(dispatchAction("windows.close"))).toBe('{"dispatch":"windows.close"}');
  });

  test("the vocabulary is generated in the platform's order", () => {
    expect([...KnownOutputKinds]).toEqual(["choices", "mode", "outcome", "problem", "progress"]);
  });

  test("outputState carries the document untouched and decodes {ok, generation}", async () => {
    const p = new Plugin();
    let sent: unknown;
    // @ts-expect-error stub
    p.call = async (method: string, params: unknown) => {
      expect(method).toBe("output.state");
      sent = params;
      return { ok: true, generation: 7, meaning_changed: true };
    };
    const doc: OutputState = {
      channel: "discovery",
      kind: OutputKindChoices,
      title: "Commands",
      phrase: "twelve commands",
      sections: [{ title: "Windows", items: [{ id: "snap_left", title: "snap left", phrase: "snap left", action: sayAction("snap left") }] }],
      urgency: OutputUrgencyAmbient,
      locale: "en",
      v: 1,
    };
    const res = await p.outputState(doc);
    expect(sent).toEqual({ state: doc });
    expect(res).toEqual({ ok: true, generation: 7, meaning_changed: true });
  });
});
