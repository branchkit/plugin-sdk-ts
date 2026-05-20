import { Plugin } from "./plugin.js";
import { MethodPluginDebug } from "./contracts_gen.js";

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Write a tagged structured payload to this plugin's dedicated log
     * at `<app_support>/plugin-logs/<pluginID>.log`.
     *
     * Use this for diagnostic chatter that aids debugging this plugin
     * specifically but doesn't belong interleaved with the actuator's
     * cross-cutting log (see `notes/DESIGN_PLUGIN_LOGGING.md`).
     *
     * Use {@link Log} (`shared.Logf` equivalent) instead for lines that
     * describe coordination with the actuator or other plugins.
     *
     * Best-effort; resolves once the actuator acknowledges the write.
     * `tag` may be empty; `data` may be any JSON-serializable value.
     */
    debug(tag: string, data: unknown): Promise<void>;
  }
}

Plugin.prototype.debug = async function (tag: string, data: unknown) {
  await this.call(MethodPluginDebug, { tag, data });
};
