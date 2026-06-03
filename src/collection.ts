import { EventCollectionUpdated } from "./contracts_gen.js";
import { Plugin } from "./plugin.js";
import type { ListOpts, CollectionRecord, CollectionPutEntry } from "./types_gen.js";

export type { CollectionPutEntry };

/** Payload of `_platform.collection.updated` notifications. */
export interface CollectionChangedEvent {
  collection: string;
  writer: string;
}

declare module "./plugin.js" {
  interface Plugin {
    /** Returns undefined if no record with that id exists. */
    get(name: string, id: string): Promise<CollectionRecord | undefined>;

    list(name: string, opts?: ListOpts): Promise<CollectionRecord[]>;

    /** Like {@link Plugin.list} but also returns the unfiltered total. */
    listPage(
      name: string,
      opts?: ListOpts,
    ): Promise<{ records: CollectionRecord[]; total: number }>;

    count(name: string): Promise<number>;

    /**
     * Single-record upsert. Sugar over the bulk wire shape — wraps
     * one entry in a 1-element array. If the target collection name
     * isn't registered yet, the platform auto-registers it as a
     * record-keyed dynamic collection with this plugin as the
     * introducer.
     */
    put(name: string, id: string, payload: unknown): Promise<void>;

    /**
     * Bulk upsert. Returns the number of records upserted (always
     * `entries.length` on success — the count is informational, useful
     * for telemetry). Validation runs across all entries before any
     * commit, so a partial batch with one invalid entry leaves the
     * backend untouched.
     */
    putMany(name: string, entries: CollectionPutEntry[]): Promise<number>;

    /**
     * Errors with NOT_FOUND if no record with that id exists, or
     * OPERATION_NOT_PERMITTED on collections the state forbids
     * patching (e.g., log-shaped, or gate-feed during the state
     * transition).
     */
    patch(name: string, id: string, fields: unknown): Promise<void>;

    /**
     * Single-record delete. Returns whether the record existed and
     * was removed. Sugar over the bulk wire shape.
     */
    delete(name: string, id: string): Promise<boolean>;

    /**
     * Bulk delete. Returns `{ deleted, alreadyAbsent }` so callers
     * can detect drift between their view of the collection and the
     * platform's — a high `alreadyAbsent` count suggests something
     * else is wiping records.
     */
    deleteMany(
      name: string,
      ids: string[],
    ): Promise<{ deleted: number; alreadyAbsent: number }>;

    /**
     * Multiple subscriptions on the same name run independently. There
     * is no Unsubscribe today; subscriptions live for the plugin
     * process's lifetime.
     */
    subscribe(name: string, fn: (evt: CollectionChangedEvent) => void): void;
  }
}

Plugin.prototype.get = async function (
  name: string,
  id: string,
): Promise<CollectionRecord | undefined> {
  const res = await this.collectionFetch(id, name);
  // res.record is `unknown` because the Rust type is Option<CollectionRecord>
  // and the TS emitter routes Option<T> through unknown.
  if (!res || res.record == null) return undefined;
  return res.record as CollectionRecord;
};

Plugin.prototype.list = async function (
  name: string,
  opts?: ListOpts,
): Promise<CollectionRecord[]> {
  const res = await this.collectionList(name, opts);
  return res?.records ?? [];
};

Plugin.prototype.listPage = async function (
  name: string,
  opts?: ListOpts,
): Promise<{ records: CollectionRecord[]; total: number }> {
  const res = await this.collectionList(name, opts);
  return { records: res?.records ?? [], total: res?.total ?? 0 };
};

Plugin.prototype.count = async function (name: string): Promise<number> {
  const res = await this.collectionCount(name);
  return res?.count ?? 0;
};

Plugin.prototype.put = async function (
  name: string,
  id: string,
  payload: unknown,
): Promise<void> {
  await this.collectionPut([{ id, payload }], name);
};

Plugin.prototype.putMany = async function (
  name: string,
  entries: CollectionPutEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await this.collectionPut(entries, name);
  return res?.count ?? 0;
};

Plugin.prototype.patch = async function (
  name: string,
  id: string,
  fields: unknown,
): Promise<void> {
  await this.collectionPatch(fields, id, name);
};

Plugin.prototype.delete = async function (name: string, id: string): Promise<boolean> {
  const res = await this.collectionDeleteRecords([id], name);
  return (res?.deleted ?? 0) > 0;
};

Plugin.prototype.deleteMany = async function (
  name: string,
  ids: string[],
): Promise<{ deleted: number; alreadyAbsent: number }> {
  if (ids.length === 0) return { deleted: 0, alreadyAbsent: 0 };
  const res = await this.collectionDeleteRecords(ids, name);
  return {
    deleted: res?.deleted ?? 0,
    alreadyAbsent: res?.already_absent ?? 0,
  };
};

Plugin.prototype.subscribe = function (
  name: string,
  fn: (evt: CollectionChangedEvent) => void,
): void {
  this.on(EventCollectionUpdated, (params: unknown) => {
    const evt = params as CollectionChangedEvent | undefined;
    if (evt && evt.collection === name) {
      fn(evt);
    }
  });
};

/**
 * Build a ListOpts with typed scalar values. The auto-generated shape
 * uses `unknown` for the four optional filter fields (a TS codegen
 * artifact for `Option<T>`), so this helper exists to keep callers
 * from juggling untyped values inline.
 */
export function listOpts(opts: {
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  cursor?: string;
}): ListOpts {
  const out: ListOpts = {};
  if (opts.sinceMs !== undefined) out.since_ms = opts.sinceMs;
  if (opts.untilMs !== undefined) out.until_ms = opts.untilMs;
  if (opts.limit !== undefined) out.limit = opts.limit;
  if (opts.cursor !== undefined) out.cursor = opts.cursor;
  return out;
}
