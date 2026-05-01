import { EventCollectionUpdated } from "./contracts_gen.js";
import { Plugin } from "./plugin.js";
import type { ListOpts, CollectionRecord } from "./types_gen.js";

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

    put(name: string, id: string, payload: unknown): Promise<void>;

    /**
     * Errors with NOT_FOUND if no record with that id exists, or
     * OPERATION_NOT_PERMITTED on collections the state forbids
     * patching (e.g., log-shaped, or gate-feed during the state
     * transition).
     */
    patch(name: string, id: string, fields: unknown): Promise<void>;

    /** Returns whether the record existed. */
    delete(name: string, id: string): Promise<boolean>;

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
  await this.collectionPut(id, name, payload);
};

Plugin.prototype.patch = async function (
  name: string,
  id: string,
  fields: unknown,
): Promise<void> {
  await this.collectionPatch(fields, id, name);
};

Plugin.prototype.delete = async function (name: string, id: string): Promise<boolean> {
  const res = await this.collectionDeleteRecord(id, name);
  return res?.deleted ?? false;
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
