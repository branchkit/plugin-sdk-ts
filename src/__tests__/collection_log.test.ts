import { describe, test, expect } from "bun:test";
import {
  Plugin,
  RpcCallError,
  RecordingDisabledError,
  errorKindOf,
} from "../plugin.js";
import {
  ErrorKindRecordingDisabled,
  ErrorKindNotFound,
} from "../closed_vocab_gen.js";
import { logListOpts } from "../collection_log.js";
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

  // The wire→class mapping itself lives in `rpcErrorFor` and is exercised
  // end to end by the conformance harness (`Structured errors` category,
  // all three lanes) because only that path goes through a real wire error.
  // What this asserts is the contract the mapping produces: the sentinel is
  // an RpcCallError carrying the kind, and `append` propagates it untouched
  // rather than re-wrapping or swallowing it.
  test("append propagates RecordingDisabledError carrying its kind", async () => {
    // The message deliberately omits the "RECORDING_DISABLED" token — nothing
    // in the path is allowed to depend on the prose.
    const wire = new RecordingDisabledError(
      -32006,
      "log collection 'x' has recording turned off",
      {
        kind: ErrorKindRecordingDisabled,
        op: "append",
        collection: "x",
        detail: "log collection 'x' has recording turned off",
      },
    );
    const { plugin } = fakePlugin(() => wire);

    let caught: unknown;
    try {
      await plugin.append("x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(wire);
    expect(caught).toBeInstanceOf(RecordingDisabledError);
    expect(caught).toBeInstanceOf(RpcCallError);
    expect(errorKindOf(caught)).toBe(ErrorKindRecordingDisabled);
    expect((caught as RpcCallError).data?.op).toBe("append");
  });

  // An actuator predating structured errors sends no `data`. The call must
  // still produce a usable error, but cannot be classified — so kind-based
  // matching correctly does not fire.
  test("an error without data degrades instead of throwing", async () => {
    const { plugin } = fakePlugin(
      () => new RpcCallError(-1, "RECORDING_DISABLED: recording is off"),
    );

    let caught: unknown;
    try {
      await plugin.append("x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcCallError);
    expect(caught).not.toBeInstanceOf(RecordingDisabledError);
    expect((caught as RpcCallError).kind).toBeUndefined();
    expect((caught as RpcCallError).message).toBe("RECORDING_DISABLED: recording is off");
    expect(errorKindOf(caught)).toBeUndefined();
  });

  // A kind this SDK has no constant for must fall through, not blow up.
  test("an unrecognized kind degrades to the generic error", async () => {
    const { plugin } = fakePlugin(
      () =>
        new RpcCallError(-32099, "something new happened", {
          kind: "teleportation_failed",
        }),
    );

    let caught: unknown;
    try {
      await plugin.append("x", {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(RpcCallError);
    expect(caught).not.toBeInstanceOf(RecordingDisabledError);
    expect(errorKindOf(caught)).toBe("teleportation_failed");
    expect(errorKindOf(caught)).not.toBe(ErrorKindNotFound);
  });

  test("the error kind carries the structured detail members", async () => {
    const err = new RpcCallError(-32002, "OPERATION_NOT_PERMITTED (Put): append-only", {
      kind: "not_permitted",
      op: "put",
      collection: "evts",
      detail: "append-only",
    });
    expect(err.kind).toBe("not_permitted");
    expect(err.data?.op).toBe("put");
    expect(err.data?.collection).toBe("evts");
    // `detail` is the reason WITHOUT the taxonomy prefix `message` carries.
    expect(err.data?.detail).toBe("append-only");
    expect(err.message).toContain("OPERATION_NOT_PERMITTED");
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
