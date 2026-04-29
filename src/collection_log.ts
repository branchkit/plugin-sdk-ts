// Helpers for log-kind collections — append-only record stores defined
// in the plugin manifest as `kind: "log"`. The auto-generated methods
// in methods_gen.ts are namespaced with the `collection*` prefix to
// match the existing collection family. The helpers below provide
// shorter, payload-typed wrappers that mirror the SDK spec §4.6 surface
// and the parallel Go SDK helpers.

import { Plugin } from "./plugin.js";
import type { LogEntry, LogListOpts } from "./types_gen.js";

/**
 * Sentinel for the "RECORDING_DISABLED" wire error returned by the
 * actuator when an Append targets a log collection whose recording flag
 * is off. Throw an instance of this; callers can `instanceof` check it
 * to drop silently or surface a one-time warning.
 */
export class RecordingDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordingDisabledError";
  }
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

    /** Fetch one entry by id. Returns undefined if it doesn't exist. */
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
    throw maybeWrapRecordingDisabled(e);
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
    throw maybeWrapRecordingDisabled(e);
  }
};

Plugin.prototype.listLog = async function (
  name: string,
  opts?: LogListOpts,
): Promise<LogEntry[]> {
  const res = await this.collectionListLog(name, opts);
  return res?.entries ?? [];
};

Plugin.prototype.listLogPage = async function (
  name: string,
  opts?: LogListOpts,
): Promise<{ entries: LogEntry[]; total: number }> {
  const res = await this.collectionListLog(name, opts);
  return { entries: res?.entries ?? [], total: res?.total ?? 0 };
};

Plugin.prototype.getLogEntry = async function (
  name: string,
  id: string,
): Promise<LogEntry | undefined> {
  const res = await this.collectionGetLogEntry(id, name);
  // res.entry is typed as `unknown` by codegen because the Rust type is
  // Option<LogEntry> and the TS emitter routes Option<T> through unknown.
  // null/undefined → entry not found.
  if (!res || res.entry == null) return undefined;
  return res.entry as LogEntry;
};

Plugin.prototype.deleteLogEntry = async function (
  name: string,
  id: string,
): Promise<boolean> {
  const res = await this.collectionDeleteLogEntry(id, name);
  return res?.deleted ?? false;
};

Plugin.prototype.setCollectionRecording = async function (
  name: string,
  enabled: boolean,
): Promise<void> {
  await this.collectionSetRecording(enabled, name);
};

Plugin.prototype.getCollectionRecording = async function (name: string): Promise<boolean> {
  const res = await this.collectionGetRecording(name);
  return res?.enabled ?? false;
};

function maybeWrapRecordingDisabled(e: unknown): unknown {
  if (e instanceof Error && e.message.includes("RECORDING_DISABLED")) {
    return new RecordingDisabledError(e.message);
  }
  return e;
}

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
