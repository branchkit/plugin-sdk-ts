import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { HookListMethods, HookOnStop } from "../contracts_gen.js";

/** Run a registered request handler the way the read loop does. */
async function request(p: Plugin, method: string, params: unknown): Promise<unknown> {
  // @ts-expect-error — reaching the private handler map for a unit test
  const fn = p.handlers.get(method);
  if (!fn) throw new Error(`no handler for ${method}`);
  return fn(params);
}

describe("onStop", () => {
  test("registering it names on_stop in list_methods", async () => {
    const p = new Plugin({ detached: true });
    const before = (await request(p, HookListMethods, {})) as { methods: string[] };
    expect(before.methods).not.toContain(HookOnStop);
    p.onStop(() => {});
    const after = (await request(p, HookListMethods, {})) as { methods: string[] };
    expect(after.methods).toContain(HookOnStop);
  });

  test("the cleanup runs, may call the platform, and on_stop is answered after it", async () => {
    const p = new Plugin({ detached: true });
    const order: string[] = [];
    // @ts-expect-error — stubbing for unit test
    p.call = async (method: string) => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(`call ${method}`);
      return { data: null };
    };
    p.onStop(async () => {
      await p.call("collection.get", { name: "on_stop_probe" });
      order.push("cleanup done");
    });
    const answer = await request(p, HookOnStop, {});
    order.push("answered");
    expect(answer).toEqual({});
    expect(order).toEqual(["call collection.get", "cleanup done", "answered"]);
  });

  test("a throw is the answer", async () => {
    const p = new Plugin({ detached: true });
    p.onStop(async () => {
      throw new Error("windows not restored");
    });
    await expect(request(p, HookOnStop, {})).rejects.toThrow("windows not restored");
  });
});
