import { EventCollectionUpdated } from "./contracts_gen.js";
import { Plugin } from "./plugin.js";
import type {
  ListOpts,
  CollectionRecord,
  CollectionPutEntry,
  FieldDisplay,
} from "./types_gen.js";

export type { CollectionPutEntry };

/** Payload of `_platform.collection.updated` notifications. */
export interface CollectionChangedEvent {
  collection: string;
  writer: string;
}

/**
 * Bounds what a {@link Plugin.replace} is allowed to DELETE, WITHIN the records
 * this plugin owns. A replace never reaches another plugin's records whatever
 * the scope says: the platform computes the complement over records whose
 * writer is the caller, so the worst a wrong scope can do is delete too much of
 * your own.
 *
 * Still required and never inferred, because "everything I own here" and "the
 * subset under this key space" are different intentions, and guessing between
 * them is how a refresh silently becomes a wipe.
 *
 * Construct with {@link scopeCollection} or {@link scopePrefix}.
 */
export type ReplaceScope =
  | { kind: "collection" }
  | { kind: "prefix"; value: string };

/**
 * Every other record THIS PLUGIN owns in the collection is the complement:
 * after the call, the records you own here are exactly the ones you passed.
 * Other plugins' records, and any the user added through Settings, are
 * untouched and invisible to the diff.
 *
 * Safe on a collection you did not declare — `writers: anyone_who_declares`
 * collections are meant to have several contributors, and each can manage its
 * own with this. Reach for {@link scopePrefix} when you keep SEVERAL
 * independent replace-sets in one collection, not merely because you are not
 * the owner.
 */
export function scopeCollection(): ReplaceScope {
  return { kind: "collection" };
}

/**
 * Narrows further, to ids starting with `prefix`, so one plugin can maintain
 * several independent replace-sets in one collection (per-tab hint sets,
 * per-source command sets). Entries whose id falls outside the prefix are
 * rejected rather than written — accepting them would create records the same
 * call could never clean up.
 */
export function scopePrefix(prefix: string): ReplaceScope {
  return { kind: "prefix", value: prefix };
}

/**
 * What a {@link Plugin.replace} changed. Counts are split for drift detection,
 * like `deleteMany`'s: a caller that expected a steady state and sees a nonzero
 * `put` or `deleted` has diverged from the platform's view.
 */
export interface ReplaceResult {
  /** Records written — new, or whose payload differed. */
  put: number;
  /** Records removed because they were in scope but not in the desired set. */
  deleted: number;
  /**
   * Records left untouched because their payload was byte-identical. Load
   * bearing: skipping these is what keeps a periodic refresh from re-firing
   * `_platform.collection.updated` per record and waking every subscriber.
   */
  skipped: number;
}

/**
 * Presentation metadata a {@link Plugin.replace} may carry alongside its
 * records. Both fields describe how a DYNAMIC collection renders; a collection
 * declared in plugin.json sets the same things there instead, and passing them
 * here would be redundant.
 *
 * Safe to pass on every call. The platform's semantics are last-write-wins,
 * and a replace that omits a field leaves the prior setting in place — so
 * re-asserting the same values on each publish costs nothing and keeps them
 * correct across a plugin restart.
 */
export interface ReplaceDisplay {
  /**
   * Display roles for this collection's fields (field name → role), telling
   * display surfaces which payload field is the primary label, the subtitle,
   * the group header, and so on.
   */
  roles?: Record<string, FieldDisplay>;
  /**
   * The collection's human-readable category name — what display surfaces (the
   * Discovery HUD's tag badge, Settings) render instead of humanizing the
   * collection id.
   */
  label?: string;
}

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Returns undefined if no record with that id exists.
     *
     * On a keyed (compacted-changelog) log, `get` returns the RAW entry with
     * that id — for a key, the introducing record WITHOUT later annotations.
     * Use {@link Plugin.getCompacted} for the folded current state.
     */
    get(name: string, id: string): Promise<CollectionRecord | undefined>;

    /**
     * Read a keyed log's folded CURRENT state for one key — the point-read half
     * of the compacted-changelog projection (paired with
     * {@link Plugin.listCompacted}). `key` is the fold key; same-key appends are
     * merged per the collection's `merge` and that key's current record is
     * returned, or undefined if the key has no records. Throws if the collection
     * is not a keyed (`id_strategy: by_field`) log. See
     * notes/DESIGN_LOG_ANNOTATION_PROJECTION.md.
     */
    getCompacted(name: string, key: string): Promise<CollectionRecord | undefined>;

    list(name: string, opts?: ListOpts): Promise<CollectionRecord[]>;

    /**
     * Read the compacted-changelog projection of a keyed log — one folded
     * record per key (its current state) instead of the raw append history.
     * Same-key records are merged per the collection's `merge` (Authoritative:
     * later non-null fields win; Collect: payloads accumulate into an array).
     * Pairs with {@link Plugin.appendKeyed}. Throws if the collection is not a
     * keyed (`id_strategy: by_field`) log. `opts` since/until/limit apply to
     * the folded records. See notes/DESIGN_LOG_ANNOTATION_PROJECTION.md.
     */
    listCompacted(name: string, opts?: ListOpts): Promise<CollectionRecord[]>;

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
     * introducer. IMPORTANT: an auto-registered collection uses
     * memory-only storage — it is EPHEMERAL and lost on restart (the
     * default suits session-scoped data like browser hints). For
     * DURABLE storage, declare the collection in your plugin manifest
     * (a "log" or "data" preset) rather than relying on cold-put
     * auto-registration.
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
     * Make the records in scope exactly `entries`: upsert what changed, delete
     * what is absent, skip what is byte-identical.
     *
     * Prefer this over hand-rolling a diff. Computing the complement on the
     * plugin side means remembering what you last published, and that memory
     * dies with the process — which is precisely the orphaned-record bug this
     * replaces. The platform already knows what is in the collection, so it
     * needs no shadow.
     *
     * ```ts
     * // publish this tab's hints, clearing any this tab published before
     * await plugin.replace("browser_hints", entries, scopePrefix(`${tabId}:`));
     * ```
     *
     * A name the platform does not know yet is created on first call, with
     * this plugin as its introducer — the same auto-registration `put`
     * performs.
     *
     * See notes/DESIGN_COLLECTION_REPLACE.md.
     */
    replace(
      name: string,
      entries: CollectionPutEntry[],
      scope: ReplaceScope,
      opts?: ReplaceDisplay,
    ): Promise<ReplaceResult>;

    /**
     * Bulk upsert with optional per-payload-field display roles. Used
     * by plugins that auto-register dynamic collections and want the
     * discovery HUD / Settings UI to know which payload field is the
     * subtitle, primary label, etc. Roles persist on the collection
     * — pass them on the first put to a new name, then omit on
     * subsequent puts.
     */
    putManyWithRoles(
      name: string,
      entries: CollectionPutEntry[],
      roles: Record<string, string>,
    ): Promise<number>;

    /**
     * Bulk upsert that also sets the collection's human-readable label —
     * the friendly category name shown on the Discovery HUD's tag badge and
     * in the Settings UI, in place of the raw collection id (e.g. "Badge"
     * instead of "browser_hints_arch_strict"). Pass "" to leave the label
     * unchanged; like roles, it persists on the collection.
     */
    putManyWithDisplay(
      name: string,
      entries: CollectionPutEntry[],
      roles: Record<string, string> | undefined,
      label: string,
    ): Promise<number>;

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
     *
     * An async handler is awaited before the next notification is delivered —
     * return the promise rather than `void`-ing it, or two rapid updates race
     * and the later-resolving one wins regardless of wire order.
     */
    subscribe(
      name: string,
      fn: (evt: CollectionChangedEvent) => void | Promise<void>,
    ): void;
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

Plugin.prototype.getCompacted = async function (
  name: string,
  key: string,
): Promise<CollectionRecord | undefined> {
  const res = await this.collectionFetchCompacted(key, name);
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

Plugin.prototype.listCompacted = async function (
  name: string,
  opts?: ListOpts,
): Promise<CollectionRecord[]> {
  const res = await this.collectionList(name, { ...opts, compacted: true });
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
  await this.collectionPut(name, [{ id, payload }]);
};

Plugin.prototype.putMany = async function (
  name: string,
  entries: CollectionPutEntry[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await this.collectionPut(name, entries);
  return res?.count ?? 0;
};

Plugin.prototype.replace = async function (
  name: string,
  entries: CollectionPutEntry[],
  scope: ReplaceScope,
  opts?: ReplaceDisplay,
): Promise<ReplaceResult> {
  // No early return on an empty `entries`: replacing with the empty set is how
  // a caller CLEARS its scope, and short-circuiting would silently turn that
  // into a no-op — the opposite of what was asked.
  const res = await this.collectionReplace(
    name,
    scope,
    entries,
    opts?.label,
    opts?.roles,
  );
  return {
    put: res?.put ?? 0,
    deleted: res?.deleted ?? 0,
    skipped: res?.skipped ?? 0,
  };
};

Plugin.prototype.putManyWithRoles = async function (
  name: string,
  entries: CollectionPutEntry[],
  roles: Record<string, string>,
): Promise<number> {
  return this.putManyWithDisplay(name, entries, roles, "");
};

Plugin.prototype.putManyWithDisplay = async function (
  name: string,
  entries: CollectionPutEntry[],
  roles: Record<string, string> | undefined,
  label: string,
): Promise<number> {
  if (entries.length === 0) return 0;
  const res = await this.collectionPut(name, entries, label || undefined, roles);
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
  const res = await this.collectionDeleteRecords(name, [id]);
  return (res?.deleted ?? 0) > 0;
};

Plugin.prototype.deleteMany = async function (
  name: string,
  ids: string[],
): Promise<{ deleted: number; alreadyAbsent: number }> {
  if (ids.length === 0) return { deleted: 0, alreadyAbsent: 0 };
  const res = await this.collectionDeleteRecords(name, ids);
  return {
    deleted: res?.deleted ?? 0,
    alreadyAbsent: res?.already_absent ?? 0,
  };
};

Plugin.prototype.subscribe = function (
  name: string,
  fn: (evt: CollectionChangedEvent) => void | Promise<void>,
): void {
  this.on(EventCollectionUpdated, (params: unknown) => {
    const evt = params as CollectionChangedEvent | undefined;
    if (evt && evt.collection === name) {
      // Return, don't discard: the ordered pump awaits this, which is what
      // keeps two rapid updates from racing.
      return fn(evt);
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
  /**
   * Return only records owned by this writer — the plugin id that CREATED
   * them, or `"_platform"` for host writes. Exact equality; omitting it
   * returns every record whoever owns it.
   *
   * Pair with `plugin.id` to ask for your own records, the read half of a
   * scoped write. Filtering happens before `limit`, so a limited read returns
   * up to `limit` MATCHING records rather than the matches within the first
   * `limit` records.
   */
  writer?: string;
}): ListOpts {
  const out: ListOpts = {};
  if (opts.sinceMs !== undefined) out.since_ms = opts.sinceMs;
  if (opts.untilMs !== undefined) out.until_ms = opts.untilMs;
  if (opts.limit !== undefined) out.limit = opts.limit;
  if (opts.cursor !== undefined) out.cursor = opts.cursor;
  if (opts.writer !== undefined) out.writer = opts.writer;
  return out;
}
