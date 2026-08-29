import { Plugin } from "./plugin.js";
import { MethodPluginDebug } from "./contracts_gen.js";

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Write a per-record diagnostic line at trace level. Dropped by default
     * (threshold defaults to `info`); surface by setting the plugin's
     * threshold to `trace` via the Settings UI Debug tab or the
     * `BRANCHKIT_LOG_PLUGIN` env var.
     */
    trace(tag: string, data: unknown): Promise<void>;
    /**
     * Write a tagged structured payload to this plugin's dedicated log
     * at `<app_support>/plugin-logs/<pluginID>.log` at debug level.
     *
     * v1 surface — kept for back-compat. With v2's default threshold of
     * `info`, plain `debug` calls are dropped unless the plugin's
     * threshold is lowered. Use {@link Plugin.info} for per-operation
     * diagnostics you want visible by default.
     *
     * See `docs/design/DESIGN_PLUGIN_LOG_LEVELS.md` for the level taxonomy.
     */
    debug(tag: string, data: unknown): Promise<void>;
    /**
     * Write a per-operation diagnostic line at info level. Visible by
     * default. Use for notable plugin-internal events.
     */
    info(tag: string, data: unknown): Promise<void>;
    /**
     * Write a warning line. Cross-posted to `actuator.log` via the
     * `plugin.diagnostic` event so plugin-level warnings interleave
     * with the actuator's view of dispatch / coordination.
     */
    warn(tag: string, data: unknown): Promise<void>;
    /**
     * Write an error line. Cross-posted to `actuator.log` (same as `warn`).
     * Use for unrecoverable problems within plugin scope.
     */
    error(tag: string, data: unknown): Promise<void>;
    /**
     * Level-by-string helper for HTTP bridges that forward
     * `plugin-debug-log` requests with a `level` field from the
     * extension. First-party plugin code should call
     * `trace`/`debug`/`info`/`warn`/`error` directly. Unknown level
     * strings fall through to `debug`.
     */
    logAt(level: string, tag: string, data: unknown): Promise<void>;
  }
}

Plugin.prototype.trace = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data, level: "trace" });
};
Plugin.prototype.debug = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data, level: "debug" });
};
Plugin.prototype.info = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data, level: "info" });
};
Plugin.prototype.warn = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data, level: "warn" });
};
Plugin.prototype.error = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data, level: "error" });
};
Plugin.prototype.logAt = async function (level: string, tag: string, data: unknown) {
  const normalized = ["trace", "debug", "info", "warn", "error"].includes(level)
    ? level
    : "debug";
  await this.call(MethodPluginDebug, { tag, data, level: normalized });
};
