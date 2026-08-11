import "./collection.js"; // subscribe() augmentation
import { Log } from "./log.js";
import { Plugin } from "./plugin.js";
import type { CollectionGetResponse } from "./types_gen.js";

/**
 * A local, always-fresh copy of a collection this plugin consumes
 * (typically one another plugin owns). Replaces the hand-rolled
 * cache + `collection.get` + refetch-on-event pattern.
 *
 * Freshness model:
 * - fetches once at `on_ready` — the documented earliest safe point to
 *   read other plugins' collections
 * - refetches whenever `_platform.collection.updated` fires for this
 *   collection (the plugin manifest must subscribe to that event
 *   pattern in `consumes.events`, or the event never arrives)
 * - an unpopulated collection (owner hasn't Put yet — the boot race)
 *   is NOT an error: the mirror stays not-ready and the update event
 *   completes it
 *
 * See `notes/DESIGN_COLLECTION_MIRROR.md`.
 */
export class CollectionMirror {
  #plugin: Plugin;
  #name: string;
  #compacted: boolean;
  #data: unknown = null;
  #ready = false;
  #onChange: Array<() => void> = [];

  /** @internal — use {@link Plugin.mirrorCollection} / {@link Plugin.mirrorCompacted}. */
  constructor(plugin: Plugin, name: string, compacted = false) {
    this.#plugin = plugin;
    this.#name = name;
    this.#compacted = compacted;
  }

  /** True once the mirror has fetched a populated snapshot. */
  get ready(): boolean {
    return this.#ready;
  }

  /**
   * The last populated `data` payload, or `null` before the first
   * populated fetch. Singleton collections unwrap to their object
   * shape; multi-record collections are an array of records — the same
   * shapes `collection.get` returns. Cast to your expected shape.
   */
  raw(): unknown {
    return this.#data;
  }

  /**
   * Register a callback fired after every successful refresh (initial
   * fetch, update-event refetch, or manual {@link refresh}). Use it to
   * maintain a decoded view of the snapshot.
   */
  onChange(fn: () => void): void {
    this.#onChange.push(fn);
  }

  /**
   * Synchronously refetch the collection. A populated response updates
   * the snapshot, marks the mirror ready, and fires onChange callbacks.
   * An unpopulated response is a silent no-op (boot race — the update
   * event will complete the mirror). An RPC error rejects and leaves
   * the previous snapshot intact.
   */
  async refresh(): Promise<void> {
    let data: unknown;
    if (this.#compacted) {
      // Folded view: one record per key. An empty array is the boot-race
      // no-op, same as a raw unpopulated read.
      const recs = await this.#plugin.listCompacted(this.#name);
      if (recs.length === 0) {
        return;
      }
      data = recs;
    } else {
      const res: CollectionGetResponse = await this.#plugin.collectionGet(this.#name);
      if (unpopulated(res?.data)) {
        return;
      }
      data = res.data;
    }
    this.#data = data;
    this.#ready = true;
    for (const fn of [...this.#onChange]) {
      fn();
    }
  }

  /** @internal — wires the on_ready fetch and update-event refetch. */
  attach(): void {
    // Reads BRANCHKIT_PLUGIN_ID, the same source Plugin's constructor
    // uses, so log lines carry the plugin prefix without depending on
    // Plugin's private field.
    const selfId = process.env.BRANCHKIT_PLUGIN_ID ?? "unknown";
    // RETURN the refresh promise — the ordered notification pump awaits it, so
    // refreshes run one at a time in wire order. Discarding it (`void ...`) let
    // N rapid update events start N concurrent collection.get calls, and
    // whichever resolved LAST won the snapshot write regardless of which event
    // it belonged to. The Go SDK gets this for free: its notify worker is a
    // single goroutine calling Refresh() synchronously.
    //
    // This cannot deadlock: refresh() blocks on an outbound call whose response
    // is delivered by the read loop, which runs independently of this pump.
    this.#plugin.onReady(() =>
      this.refresh().catch((err) => {
        Log(selfId, `mirror "${this.#name}": initial fetch failed: ${err}`);
      }),
    );
    this.#plugin.subscribe(this.#name, () =>
      this.refresh().catch((err) => {
        Log(selfId, `mirror "${this.#name}": refresh failed: ${err}`);
      }),
    );
  }
}

/**
 * The empty sentinel an unwritten collection returns (`[]`, `null`, or
 * absent) — including for singleton schemas, which only unwrap to
 * their object shape once the owner has Put.
 */
function unpopulated(data: unknown): boolean {
  return data == null || (Array.isArray(data) && data.length === 0);
}

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Create a {@link CollectionMirror} of `name` and wire its
     * freshness hooks. Must be called before {@link Plugin.run} so the
     * on_ready fetch lands.
     */
    mirrorCollection(name: string): CollectionMirror;

    /**
     * Mirror the FOLDED current-state view of a keyed (compacted-changelog)
     * log — the same records `listCompacted` returns, one per key — kept fresh
     * the same way {@link Plugin.mirrorCollection} is. Use this instead of
     * `mirrorCollection` for a keyed log: plain `mirrorCollection` mirrors the
     * RAW append history (every append, unfolded), almost never what a consumer
     * of a keyed log wants. The mirrored collection must declare
     * `emits_on_change: true` for the refetch-on-change to fire (logs default
     * off — see notes/DESIGN_LOG_ANNOTATION_PROJECTION.md).
     */
    mirrorCompacted(name: string): CollectionMirror;
  }
}

Plugin.prototype.mirrorCollection = function (name: string): CollectionMirror {
  const mirror = new CollectionMirror(this, name);
  mirror.attach();
  return mirror;
};

Plugin.prototype.mirrorCompacted = function (name: string): CollectionMirror {
  const mirror = new CollectionMirror(this, name, true);
  mirror.attach();
  return mirror;
};
