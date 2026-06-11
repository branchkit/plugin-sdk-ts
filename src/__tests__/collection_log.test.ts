import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { RecordingDisabledError, logListOpts } from "../collection_log.js";
import "../methods_gen.js"; // ensure auto-gen methods are wired before helpers
import "../collection_log.js";

/**
 * Build a Plugin with `call` stubbed. `respond(method, params)` returns
 * the result that the actuator would have sent back. The inbox lets
 * tests assert on the wire shape after the call resolves.
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

describe("collection_log helpers", () => {
  test("append returns the assigned entry id", async () => {
    const { plugin, inbox } = fakePlugin((method) => {
      expect(method).toBe("collection.append");
      return {
        entry: {
          id: "01H_XYZ",
          timestamp_ms: 1700000000000,
          payload: { msg: "hello" },
        },
      };
    });

    const id = await plugin.append("browser.activity_captures", { msg: "hello" });
    expect(id).toBe("01H_XYZ");
    expect(inbox[0]?.params).toEqual({
      name: "browser.activity_captures",
      payload: { msg: "hello" },
    });
  });

  test("append wraps RECORDING_DISABLED into RecordingDisabledError", async () => {
    const { plugin } = fakePlugin(
      () => new Error("RECORDING_DISABLED: log collection 'x' has recording turned off"),
    );

    let caught: unknown;
    try {
      await plugin.append("x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RecordingDisabledError);
  });

  test("appendEntry returns the full LogEntry", async () => {
    const { plugin } = fakePlugin(() => ({
      entry: { id: "01H_full", timestamp_ms: 12345, payload: { k: "v" } },
    }));
    const entry = await plugin.appendEntry("any", { k: "v" });
    expect(entry.id).toBe("01H_full");
    expect(entry.timestamp_ms).toBe(12345);
  });

  test("listLog returns entries in actuator order", async () => {
    const { plugin, inbox } = fakePlugin(() => ({
      records: [
        { id: "01H_B", timestamp_ms: 200, revision: 1, payload: {} },
        { id: "01H_A", timestamp_ms: 100, revision: 1, payload: {} },
      ],
      total: 2,
    }));
    const entries = await plugin.listLog("any");
    expect(entries.length).toBe(2);
    expect(entries[0]?.id).toBe("01H_B");
    expect(inbox[0]?.method).toBe("collection.list");
  });

  test("listLogPage exposes total separately from page", async () => {
    const { plugin } = fakePlugin(() => ({
      records: [{ id: "01H_one", timestamp_ms: 1, revision: 1, payload: {} }],
      total: 17,
    }));
    const page = await plugin.listLogPage("any", logListOpts({ limit: 1 }));
    expect(page.entries.length).toBe(1);
    expect(page.total).toBe(17);
  });

  test("getLogEntry returns undefined when entry is null", async () => {
    const { plugin } = fakePlugin(() => ({ record: null }));
    const entry = await plugin.getLogEntry("any", "missing");
    expect(entry).toBeUndefined();
  });

  test("getLogEntry returns typed entry when present", async () => {
    const { plugin } = fakePlugin(() => ({
      record: { id: "01H_typed", timestamp_ms: 42, revision: 1, payload: { k: "v" } },
    }));
    const entry = await plugin.getLogEntry("any", "01H_typed");
    expect(entry).toBeDefined();
    expect(entry?.id).toBe("01H_typed");
    expect(entry?.timestamp_ms).toBe(42);
  });

  test("deleteLogEntry returns the deleted boolean", async () => {
    const { plugin } = fakePlugin(() => ({ deleted: 1, already_absent: 0 }));
    expect(await plugin.deleteLogEntry("any", "01H")).toBe(true);
  });

  test("setCollectionRecording forwards enabled flag", async () => {
    const { plugin, inbox } = fakePlugin(() => undefined);
    await plugin.setCollectionRecording("any", true);
    expect(inbox[0]?.method).toBe("privacy.set_recording");
    expect((inbox[0]?.params as { enabled: boolean }).enabled).toBe(true);
  });

  test("getCollectionRecording returns the effective flag", async () => {
    const { plugin } = fakePlugin(() => ({ enabled: true }));
    expect(await plugin.getCollectionRecording("any")).toBe(true);
  });

  test("logListOpts builds a typed options object", () => {
    const opts = logListOpts({ sinceMs: 100, untilMs: 200, limit: 5, cursor: "01H_X" });
    expect(opts.since_ms).toBe(100);
    expect(opts.until_ms).toBe(200);
    expect(opts.limit).toBe(5);
    expect(opts.cursor).toBe("01H_X");
  });

  test("logListOpts omits undefined fields", () => {
    const opts = logListOpts({ limit: 5 });
    expect(opts.limit).toBe(5);
    expect(opts.since_ms).toBeUndefined();
    expect(opts.until_ms).toBeUndefined();
    expect(opts.cursor).toBeUndefined();
  });
});
