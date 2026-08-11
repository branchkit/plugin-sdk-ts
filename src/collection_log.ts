// Helpers for log-kind collections — append-only record stores defined
// in the plugin manifest as `kind: "log"`. The auto-generated methods
// in methods_gen.ts are namespaced with the `collection*` prefix to
// match the existing collection family. The helpers below provide
// shorter, payload-typed wrappers that mirror the SDK spec section 4.6 surface
// and the parallel Go SDK helpers.

import { Plugin } from "./plugin.js";
// Side-effect import: the log sugar delegates to the unified-verb
// prototype methods (get/listPage/delete) that collection.ts installs.
import "./collection.js";
import type { CollectionRecord, ListOpts, LogEntry } from "./types_gen.js";

/**
 * Filters for listLog / listLogPage. SDK-level type — the wire carries
 * the unified ListOpts (the former collection.list_log op was folded
 * into collection.list); the fields are identical by design.
 */
export interface LogListOpts {
  since_ms?: number;
  until_ms?: number;
  limit?: number;
  cursor?: string;
}

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Append an entry to a log-kind collection. The actuator generates a
     * ULID and timestamp and validates the payload against the collection's
     * declared `fields`. Returns the assigned entry id.
     *
     * Throws `RecordingDisabledError` if the collection's recording flag is
     * off — callers that want fire-and-forget semantics can catch it.
     */
    append(name: string, payload: unknown): Promise<string>;

    /** Like {@link Plugin.append} but returns the full LogEntry. */
    appendEntry(name: string, payload: unknown): Promise<LogEntry>;

    /**
     * Annotate a keyed log — a `log`-preset collection with
     * `id_strategy: by_field`. Appends `payload` with `key` stamped into the
     * collection's key field, as a fresh append (the raw log is never mutated);
     * appending another record with the same `key` folds onto the first. Read
     * the merged current-state view with {@link Plugin.listCompacted}. This is
     * the compacted-changelog primitive — see
     * notes/DESIGN_LOG_ANNOTATION_PROJECTION.md.
     *
     * "Annotate a past record" is just "append the same key with the new
     * field." Throws if the collection is not a keyed log.
     */
    appendKeyed(name: string, key: string, payload: unknown): Promise<void>;

    /**
     * List log entries newest-first. Pass undefined for default options
     * (no filter, no limit, no cursor).
     */
    listLog(name: string, opts?: LogListOpts): Promise<LogEntry[]>;

    /**
     * Like {@link Plugin.listLog} but also returns the unfiltered total
     * count for paginated UIs.
     */
    listLogPage(
      name: string,
      opts?: LogListOpts,
    ): Promise<{ entries: LogEntry[]; total: number }>;

    /**
     * Fetch one entry by id. Returns undefined if it doesn't exist. Returns the
     * RAW entry, so on a keyed (compacted-changelog) log this is the introducing
     * record without later annotations; use {@link Plugin.getCompacted} for a
     * key's current state.
     */
    getLogEntry(name: string, id: string): Promise<LogEntry | undefined>;

    /**
     * Delete one entry by id. Returns whether it existed (a no-op delete
     * is not an error — another writer may have removed it).
     */
    deleteLogEntry(name: string, id: string): Promise<boolean>;

    /**
     * Toggle the recording flag on a log-kind collection. When false,
     * subsequent {@link Plugin.append} calls throw RecordingDisabledError.
     */
    setCollectionRecording(name: string, enabled: boolean): Promise<void>;

    /**
     * Read the effective recording flag — the user override if set,
     * otherwise the manifest's `default_recording_enabled`.
     */
    getCollectionRecording(name: string): Promise<boolean>;
  }
}

Plugin.prototype.append = async function (name: string, payload: unknown): Promise<string> {
  try {
    const entry = await this.collectionAppend(name, payload);
    if (!entry) {
      throw new Error("collection.append: actuator returned no entry");
    }
    return entry.id;
  } catch (e) {
    throw e;
  }
};

Plugin.prototype.appendEntry = async function (
  name: string,
  payload: unknown,
): Promise<LogEntry> {
  try {
    const entry = await this.collectionAppend(name, payload);
    if (!entry) {
      throw new Error("collection.append: actuator returned no entry");
    }
    return entry;
  } catch (e) {
    throw e;
  }
};

Plugin.prototype.appendKeyed = async function (
  name: string,
  key: string,
  payload: unknown,
): Promise<void> {
  try {
    await this.collectionAppendKeyed(key, name, payload);
  } catch (e) {
    throw e;
  }
};

/**
 * Project the unified record envelope onto the log view. Lossless: log
 * records carry their append time in timestamp_ms.
 */
function recordToLogEntry(r: CollectionRecord): LogEntry {
  return { id: r.id, timestamp_ms: r.timestamp_ms, payload: r.payload };
}

/** Map log opts onto the unified list opts — field-identical by design. */
function logOptsToListOpts(o?: LogListOpts): ListOpts | undefined {
  if (!o) return undefined;
  return { since_ms: o.since_ms, until_ms: o.until_ms, limit: o.limit, cursor: o.cursor };
}

// Sugar over the unified verbs — the wire surface is collection.list /
// collection.fetch / collection.delete_records; log-shaped reads are the
// same list with time-window opts.

Plugin.prototype.listLog = async function (
  name: string,
  opts?: LogListOpts,
): Promise<LogEntry[]> {
  const { entries } = await this.listLogPage(name, opts);
  return entries;
};

Plugin.prototype.listLogPage = async function (
  name: string,
  opts?: LogListOpts,
): Promise<{ entries: LogEntry[]; total: number }> {
  const { records, total } = await this.listPage(name, logOptsToListOpts(opts));
  return { entries: records.map(recordToLogEntry), total };
};

Plugin.prototype.getLogEntry = async function (
  name: string,
  id: string,
): Promise<LogEntry | undefined> {
  const rec = await this.get(name, id);
  return rec ? recordToLogEntry(rec) : undefined;
};

Plugin.prototype.deleteLogEntry = async function (
  name: string,
  id: string,
): Promise<boolean> {
  return this.delete(name, id);
};

Plugin.prototype.setCollectionRecording = async function (
  name: string,
  enabled: boolean,
): Promise<void> {
  await this.privacySetRecording(enabled, name);
};

Plugin.prototype.getCollectionRecording = async function (name: string): Promise<boolean> {
  const res = await this.privacyGetRecording(name);
  return res?.enabled ?? false;
};

/**
 * Build a LogListOpts with typed scalar values. The auto-generated
 * shape uses `unknown` for the four optional filter fields (a TS
 * codegen artifact for `Option<T>`), so this helper exists to keep
 * callers from juggling untyped values inline.
 */
export function logListOpts(opts: {
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  cursor?: string;
}): LogListOpts {
  const out: LogListOpts = {};
  if (opts.sinceMs !== undefined) out.since_ms = opts.sinceMs;
  if (opts.untilMs !== undefined) out.until_ms = opts.untilMs;
  if (opts.limit !== undefined) out.limit = opts.limit;
  if (opts.cursor !== undefined) out.cursor = opts.cursor;
  return out;
}
