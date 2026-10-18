import { describe, it, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { Methods } from "../methods_gen.js";
import { methodsOver, type Caller } from "../caller.js";
import { MethodCollectionGet, MethodNativeDarkMode } from "../contracts_gen.js";

describe("generated wrappers over a Caller", () => {
  it("run over any Caller, with no transport", async () => {
    const seen: { method: string; params: unknown }[] = [];
    const fake: Caller = {
      call: async <T>(method: string, params?: unknown) => {
        seen.push({ method, params });
        return { record: { id: "a" } } as T;
      },
    };
    const got = await methodsOver(fake).collectionGet({ name: "notes" });
    expect(seen).toEqual([{ method: MethodCollectionGet, params: { name: "notes" } }]);
    expect(got).toEqual({ record: { id: "a" } } as never);
  });

  it("withTimeout passes its timeout to the plugin's call", async () => {
    const p = new Plugin({ detached: true });
    const calls: [string, number | undefined][] = [];
    p.call = (<T>(method: string, _params?: unknown, timeoutMs?: number) => {
      calls.push([method, timeoutMs]);
      return Promise.resolve({ dark_mode: true } as T);
    }) as typeof p.call;
    await p.withTimeout(42_000).nativeDarkMode();
    await p.nativeDarkMode();
    expect(calls).toEqual([
      [MethodNativeDarkMode, 42_000],
      [MethodNativeDarkMode, undefined],
    ]);
  });

  it("no member of Plugin's own overrides a generated wrapper", () => {
    // A class member of the same name would win over the generated one,
    // silently; before the wrappers were a base class, they overwrote it.
    const generated = new Set(Object.getOwnPropertyNames(Methods.prototype));
    generated.delete("constructor");
    expect(generated.size).toBeGreaterThan(400);
    const own = Object.getOwnPropertyNames(Plugin.prototype).filter((n) => generated.has(n));
    expect(own).toEqual([]);
  });
});
