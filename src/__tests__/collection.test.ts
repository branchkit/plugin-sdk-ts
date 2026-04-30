import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { listOpts, type CollectionChangedEvent } from "../collection.js";
import { EventCollectionUpdated } from "../contracts_gen.js";
import "../methods_gen.js";
import "../collection.js";

/**
 * Build a Plugin with `call` stubbed. Mirrors collection_log.test.ts
 * fixture so the substrate helper tests use the same fake transport.
 */
function fakePlugin(
  respond: (method: string, params: unknown) => unknown,
): { plugin: Plugin; inbox: { method: string; params: unknown }[] } {
  const inbox: { method: string; params: unknown }[] = [];
  const p = new Plugin();
  // @ts-expect-error — stubbing a private-ish method for unit test
  p.call = async (method: string, params: unknown) => {
    inbox.push({ method, params });
    const result = respond(method, params);
    if (result instanceof Error) throw result;
    return result;
  };
  return { plugin: p, inbox };
}

describe("collection substrate helpers", () => {
  test("get returns undefined when record absent", async () => {
    const { plugin } = fakePlugin((method) => {
      expect(method).toBe("collection.fetch");
      return { record: null };
    });
    const rec = await plugin.get("things", "missing");
    expect(rec).toBeUndefined();
  });

  test("get returns typed record when present", async () => {
    const { plugin } = fakePlugin(() => ({
      record: { id: "k1", payload: { v: 7 } },
    }));
    const rec = await plugin.get("things", "k1");
    expect(rec?.id).toBe("k1");
    expect((rec?.payload as { v: number })?.v).toBe(7);
  });

  test("put marshals payload through wire", async () => {
    const { plugin, inbox } = fakePlugin((method) => {
      expect(method).toBe("collection.put");
      return undefined;
    });
    await plugin.put("things", "k1", { v: 7 });
    expect(inbox[0]?.params).toEqual({
      id: "k1",
      name: "things",
      payload: { v: 7 },
    });
  });

  test("list returns records", async () => {
    const { plugin } = fakePlugin(() => ({
      records: [
        { id: "k1", payload: { v: 1 } },
        { id: "k2", payload: { v: 2 } },
      ],
      total: 2,
    }));
    const records = await plugin.list("things");
    expect(records.length).toBe(2);
    expect(records[0]?.id).toBe("k1");
  });

  test("listPage exposes total separately from page", async () => {
    const { plugin } = fakePlugin(() => ({
      records: [{ id: "k1", payload: {} }],
      total: 42,
    }));
    const page = await plugin.listPage("things", listOpts({ limit: 1 }));
    expect(page.records.length).toBe(1);
    expect(page.total).toBe(42);
  });

  test("count returns the record count", async () => {
    const { plugin } = fakePlugin((method) => {
      expect(method).toBe("collection.count");
      return { count: 17 };
    });
    expect(await plugin.count("things")).toBe(17);
  });

  test("delete returns whether the record existed", async () => {
    const { plugin } = fakePlugin((method) => {
      expect(method).toBe("collection.delete_record");
      return { deleted: true };
    });
    expect(await plugin.delete("things", "k1")).toBe(true);
  });

  test("patch marshals fields through wire", async () => {
    const { plugin, inbox } = fakePlugin((method) => {
      expect(method).toBe("collection.patch");
      return undefined;
    });
    await plugin.patch("things", "k1", { b: 99 });
    expect(inbox[0]?.params).toEqual({
      fields: { b: 99 },
      id: "k1",
      name: "things",
    });
  });

  test("listOpts builds typed values", () => {
    const opts = listOpts({ sinceMs: 1000, untilMs: 2000, limit: 10, cursor: "k5" });
    expect(opts.since_ms).toBe(1000);
    expect(opts.until_ms).toBe(2000);
    expect(opts.limit).toBe(10);
    expect(opts.cursor).toBe("k5");
  });

  test("subscribe filters notifications by collection name", () => {
    const p = new Plugin();
    const seen: CollectionChangedEvent[] = [];
    p.subscribe("things", (evt) => seen.push(evt));

    // Drive the on() listener directly; the actuator side is exercised
    // by the conformance harness.
    // @ts-expect-error — handleNotification is private
    p.handleNotification(EventCollectionUpdated, { collection: "things", writer: "voice" });
    // @ts-expect-error
    p.handleNotification(EventCollectionUpdated, { collection: "other", writer: "voice" });
    // @ts-expect-error
    p.handleNotification(EventCollectionUpdated, { collection: "things", writer: "voice" });

    expect(seen.length).toBe(2);
    expect(seen.every((e) => e.collection === "things")).toBe(true);
  });
});
