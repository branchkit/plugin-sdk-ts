/**
 * HUD push sugar — parity with plugin-sdk-go/hud.go. The generated
 * hudPush takes raw fragments, which proved awkward enough that callers
 * hand-rolled the envelope; these cover the two real shapes.
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
