import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import "../methods_gen.js";
import "../effects.js";
import { EventEffectDisplaced } from "../contracts_gen.js";
import type { EffectDisplacedEvent } from "../effects.js";

/** Drive the real notification pump, then let it drain. */
async function deliver(p: Plugin, params: unknown): Promise<void> {
  // @ts-expect-error — enqueueNotification is private
  p.enqueueNotification(EventEffectDisplaced, params);
  await new Promise((r) => setTimeout(r, 0));
}

describe("onEffectDisplaced", () => {
  const SELF = "test-plugin";

  function pluginAsSelf(): { p: Plugin; seen: EffectDisplacedEvent[] } {
    const prev = process.env.BRANCHKIT_PLUGIN_ID;
    process.env.BRANCHKIT_PLUGIN_ID = SELF;
    const p = new Plugin();
    const seen: EffectDisplacedEvent[] = [];
    p.onEffectDisplaced((evt) => {
      seen.push(evt);
    });
    // Signals readiness, the way a real plugin does. The notification pump
    // holds delivery until run() so a notification arriving during setup is
    // queued rather than discarded — matching the Go SDK. Without this the
    // negative cases below would pass vacuously.
    void p.run();
    if (prev === undefined) delete process.env.BRANCHKIT_PLUGIN_ID;
    else process.env.BRANCHKIT_PLUGIN_ID = prev;
    return { p, seen };
  }

  test("delivers when this plugin is the displaced owner", async () => {
    const { p, seen } = pluginAsSelf();
    await deliver(p, {
      effect: "audio.capture",
      new_owner: "other-plugin",
      displaced_owner: SELF,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({
      effect: "audio.capture",
      newOwner: "other-plugin",
      displacedOwner: SELF,
    });
  });

  test("ignores displacements of another plugin's effect", async () => {
    const { p, seen } = pluginAsSelf();
    await deliver(p, {
      effect: "audio.capture",
      new_owner: "a",
      displaced_owner: "somebody-else",
    });
    expect(seen).toHaveLength(0);
  });

  // new_owner is Option<String> on the wire. Requiring it to be a string
  // dropped real displacement events — the plugin was never told it had lost
  // the effect. Go delivers these with an empty owner; match that.
  test("delivers with an empty newOwner when new_owner is null or absent", async () => {
    const { p, seen } = pluginAsSelf();
    await deliver(p, { effect: "audio.capture", new_owner: null, displaced_owner: SELF });
    await deliver(p, { effect: "audio.capture", displaced_owner: SELF });
    expect(seen).toHaveLength(2);
    expect(seen[0]!.newOwner).toBe("");
    expect(seen[1]!.newOwner).toBe("");
    expect(seen[0]!.effect).toBe("audio.capture");
  });

  // effect and displaced_owner ARE load-bearing: one says what was lost, the
  // other is what the filter keys on. A payload missing either is uninterpretable.
  test("drops payloads missing effect or displaced_owner", async () => {
    const { p, seen } = pluginAsSelf();
    await deliver(p, { new_owner: "a", displaced_owner: SELF });
    await deliver(p, { effect: "audio.capture", new_owner: "a" });
    await deliver(p, null);
    await deliver(p, "not an object");
    expect(seen).toHaveLength(0);
  });
});
