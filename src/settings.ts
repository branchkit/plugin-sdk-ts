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
  #plugin: Plugin;
  #name: string;
  #mirror: CollectionMirror;
  #val: T | undefined;
  #onChange: Array<(v: T) => void> = [];

  /** @internal — use {@link Plugin.settings}. */
  constructor(plugin: Plugin, name: string) {
    this.#plugin = plugin;
    this.#name = name;
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

  /**
   * Relay ONE user gesture into the settings collection. Settings are
   * `writers: platform_only` — a plugin never saves settings on its own
   * initiative — so this writes tenant `_user`: the choice is the user's
   * and this plugin is the transport (the platform records it as
   * `relayed`, visible and undoable). State your plugin decides on its
   * own is domain data and belongs in its own collection, not here.
   *
   * The write and the mirror refresh are ONE operation on purpose. The
   * actuator re-renders the settings tab the moment your handler
   * returns, while the mirror normally catches up later via
   * collection.updated — a re-render that reads the mirror loses that
   * race and draws the stale value (CQRS projection lag). After setUser
   * resolves, get() observes the write.
   */
  async setUser(key: string, value: unknown): Promise<void> {
    await this.setUserFields({ [key]: value });
  }

  /**
   * setUser for a form submit: every field in one patch, one refresh.
   * Same contract — one user gesture, tenant `_user`, observable to
   * get() on resolve.
   */
  async setUserFields(fields: Record<string, unknown>): Promise<void> {
    await this.#plugin.overridesApply(
      "patch",
      this.#name,
      undefined,
      fields,
      this.#name,
      undefined,
      "_user",
    );
    await this.refresh();
  }

  /**
   * The composed settings via a synchronous read-through, updating the
   * mirror. Use at the top of render paths (`render_settings`): a render
   * must read state at least as fresh as whatever triggered it, and the
   * mirror's event-driven refresh cannot promise that ordering.
   */
  async load(): Promise<T | undefined> {
    await this.refresh();
    return this.get();
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
