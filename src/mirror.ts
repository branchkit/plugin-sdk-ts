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
  #data: unknown = null;
  #ready = false;
  #onChange: Array<() => void> = [];

  /** @internal — use {@link Plugin.mirrorCollection}. */
  constructor(plugin: Plugin, name: string) {
    this.#plugin = plugin;
    this.#name = name;
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
    const res: CollectionGetResponse = await this.#plugin.collectionGet(this.#name);
    if (unpopulated(res?.data)) {
      return;
    }
    this.#data = res.data;
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
    this.#plugin.onReady(() => {
      void this.refresh().catch((err) => {
        Log(selfId, `mirror "${this.#name}": initial fetch failed: ${err}`);
      });
    });
    this.#plugin.subscribe(this.#name, () => {
      void this.refresh().catch((err) => {
        Log(selfId, `mirror "${this.#name}": refresh failed: ${err}`);
      });
    });
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
  }
}

Plugin.prototype.mirrorCollection = function (name: string): CollectionMirror {
  const mirror = new CollectionMirror(this, name);
  mirror.attach();
  return mirror;
};
