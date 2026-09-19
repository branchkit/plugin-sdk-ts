/**
 * HUD push sugar — parity with plugin-sdk-go/hud.go. The generated
 * hudPush used to take raw fragments, which proved awkward enough that
 * callers hand-rolled the envelope; it takes `HudFragment[]` now
 * (2026-09-19), so these two stay for the lesson they carry, not the
 * envelope they build.
 */
import { Plugin } from "./plugin.js";
import "./methods_gen.js";

declare module "./plugin.js" {
  interface Plugin {
    /** Morph `html` into the element with id `targetId` inside the named
     * HUD window — the shape that sizes the window from its content
     * (raw replacement with an empty target leaves it 1px tall). */
    hudPushFragment(channel: string, targetId: string, html: string): Promise<void>;
    /** Replace the HUD window's entire content (`raw: true`) — for
     * windows whose markup carries its own container. */
    hudPushRaw(channel: string, html: string): Promise<void>;
  }
}

Plugin.prototype.hudPushFragment = function (channel: string, targetId: string, html: string) {
  return this.hudPush(channel, [{ target_id: targetId, html }]);
};

Plugin.prototype.hudPushRaw = function (channel: string, html: string) {
  return this.hudPush(channel, [{ target_id: "", html, raw: true }]);
};
