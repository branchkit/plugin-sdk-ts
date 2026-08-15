import { CollectionMirror } from "./mirror.js";
import { Log } from "./log.js";
import { Plugin } from "./plugin.js";

/**
 * Typed settings access for `preset: settings` collections
 * (DESIGN_PLUGIN_SETTINGS_STORAGE.md). The platform materializes the
 * composed view — every manifest-declared field at its shipped default,
 * with the user's sparse changes applied last — so the plugin never loads,
 * caches, or defaults anything itself. This helper replaces the hand-rolled
 * load–save–cache–defaults pattern: declare the fields (with defaults) in
 * the manifest, define a matching type, and read.
 *
 * Settings are read-only from the plugin (`writers: platform_only`):
 * anything a plugin flips programmatically is domain state, not a setting.
 * There is deliberately no save.
 */
export class SettingsMirror<T> {
  #mirror: CollectionMirror;
  #val: T | undefined;
  #onChange: Array<(v: T) => void> = [];

  /** @internal — use {@link Plugin.settings}. */
  constructor(plugin: Plugin, name: string) {
    this.#mirror = plugin.mirrorCollection(name);
    const selfId = plugin.id;
    this.#mirror.onChange(() => {
      const raw = this.#mirror.raw();
      if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        Log(selfId, `settings "${name}": composed read is not an object`);
        return;
      }
      this.#val = raw as T;
      for (const fn of [...this.#onChange]) {
        fn(this.#val);
      }
    });
  }

  /** True once a decoded snapshot exists. Unlike domain mirrors there is
   * no boot race to wait out: the composed read is materialized from
   * manifest defaults, so the first fetch always populates. */
  get ready(): boolean {
    return this.#val !== undefined;
  }

  /** The current settings, or `undefined` before the first fetch. */
  get(): T | undefined {
    return this.#val;
  }

  /**
   * Register fn to run after every successful fetch — the initial one and
   * every user edit (the platform emits collection.updated when the user
   * band changes).
   */
  onChange(fn: (v: T) => void): void {
    this.#onChange.push(fn);
  }

  /** Force a synchronous refetch. Rarely needed — the update-event path
   * keeps the mirror fresh. */
  refresh(): Promise<void> {
    return this.#mirror.refresh();
  }
}

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Typed mirror of a `preset: settings` collection. Must be called
     * before {@link Plugin.run} so the initial fetch lands.
     */
    settings<T>(name: string): SettingsMirror<T>;
  }
}

Plugin.prototype.settings = function <T>(name: string): SettingsMirror<T> {
  return new SettingsMirror<T>(this, name);
};
