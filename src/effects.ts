import { EventEffectDisplaced } from "./contracts_gen.js";
import { Plugin } from "./plugin.js";
import type { EffectDisplacedEventParams } from "./types_gen.js";

/**
 * Payload delivered to {@link Plugin.onEffectDisplaced} callbacks — the
 * camelCased view of the generated wire type
 * {@link EffectDisplacedEventParams} (this SDK camelCases its public
 * event payloads; Go keeps wire snake_case).
 */
export interface EffectDisplacedEvent {
  /** Effect name that was displaced (e.g. `"suppress_notifications"`). */
  effect: string;
  /** Plugin id that just took top-of-stack ownership of the effect. */
  newOwner: string;
  /**
   * Plugin id that lost top-of-stack ownership. The SDK filters on this
   * so `onEffectDisplaced` only fires when *this* plugin was displaced;
   * the field is exposed for plugins that subscribe to the underlying
   * event directly via `on(EventEffectDisplaced, ...)`.
   */
  displacedOwner: string;
}

/**
 * Result of {@link Plugin.assertEffect}.
 */
export interface AssertEffectResult {
  /**
   * True when the assertion is now top-of-stack OR the plugin already
   * held it (idempotent re-assert). False once user-consent revocation
   * lands and the user has revoked this effect on this plugin (consent
   * surface is post-Step-2 work).
   */
  granted: boolean;
  /**
   * True when the plugin already had an active assertion on this
   * effect. Implies `granted: true`.
   */
  alreadyHeld: boolean;
  /**
   * Name of the previous top-of-stack owner if this assertion overrode
   * someone, undefined otherwise.
   */
  displaced?: string;
  /**
   * True when the platform actually delivers this effect's semantics
   * while you hold ownership. Signal-shape effects (e.g.
   * `signal_recording_active`, whose entire meaning is the queryable
   * ownership stack) are always enforced. False means the OS handler
   * for this effect is not implemented yet: you get ownership
   * bookkeeping, displacement events, and `isEffectActive` queries,
   * but the OS-level behavior (actual notification muting, focus-steal
   * blocking, …) does NOT happen.
   */
  enforced: boolean;
}

/**
 * Result of {@link Plugin.retractEffect}.
 */
export interface RetractEffectResult {
  /**
   * True when a frame was actually removed. False when this plugin
   * held no assertion (idempotent retract).
   */
  retracted: boolean;
  /**
   * Effective owner after the retract — undefined when the stack is
   * now empty.
   */
  newOwner?: string;
}

/**
 * Result of {@link Plugin.isEffectActive}.
 */
export interface IsEffectActiveResult {
  /**
   * True when this plugin currently holds top-of-stack for the named
   * effect (i.e. is the effective owner).
   */
  active: boolean;
  /**
   * Current effective owner regardless of whether it's this plugin —
   * useful for surfacing "Meeting Mode is overriding Focus Mode" UI.
   */
  currentOwner?: string;
}

declare module "./plugin.js" {
  interface Plugin {
    /**
     * Declares this plugin is asserting `name`. The plugin must have
     * declared this effect in its manifest's `provides.effects[*].asserts`
     * — undeclared effects reject the call.
     *
     * See `notes/DESIGN_CAPABILITY_MECHANISM.md` for the mechanism design.
     */
    assertEffect(name: string): Promise<AssertEffectResult>;

    /**
     * Releases this plugin's assertion of `name`. Idempotent — retracting
     * an effect this plugin doesn't hold resolves with `retracted: false`.
     */
    retractEffect(name: string): Promise<RetractEffectResult>;

    /**
     * Returns `{ active: false }` for unknown effect names rather than
     * throwing — same shape as an empty stack — so polling on a typo'd
     * name doesn't require error handling.
     */
    isEffectActive(name: string): Promise<IsEffectActiveResult>;

    /**
     * Registers a callback fired when this plugin's assertion is
     * overridden by a later asserter.
     *
     * Delivery is broadcast — every plugin subscribed to
     * `_platform.effect.displaced` receives every displacement event.
     * This helper filters on `displacedOwner === this plugin's id` so
     * the callback only fires for *this* plugin's displacements.
     * Plugins that want to observe all displacements (e.g. a UI showing
     * system effect state) should subscribe directly via
     * `on(EventEffectDisplaced, ...)`.
     *
     * See `notes/DESIGN_CAPABILITY_MECHANISM.md` section 10.2.
     *
     * Multiple callbacks can be registered; each fires for every event.
     */
    onEffectDisplaced(handler: (evt: EffectDisplacedEvent) => void): void;
  }
}

Plugin.prototype.assertEffect = async function (
  name: string,
): Promise<AssertEffectResult> {
  const res = await this.effectsAssert(name);
  return {
    granted: res.granted,
    alreadyHeld: res.already_held,
    displaced: optionalString(res.displaced),
    enforced: res.enforced,
  };
};

Plugin.prototype.retractEffect = async function (
  name: string,
): Promise<RetractEffectResult> {
  const res = await this.effectsRetract(name);
  return {
    retracted: res.retracted,
    newOwner: optionalString(res.new_owner),
  };
};

Plugin.prototype.isEffectActive = async function (
  name: string,
): Promise<IsEffectActiveResult> {
  const res = await this.effectsIsActive(name);
  return {
    active: res.active,
    currentOwner: optionalString(res.current_owner),
  };
};

Plugin.prototype.onEffectDisplaced = function (
  handler: (evt: EffectDisplacedEvent) => void,
): void {
  // The canonical accessor — one definition of this plugin's id and its
  // fallback, rather than a second copy of the env-var lookup here.
  const selfId = this.id;
  this.on(EventEffectDisplaced, (params: unknown) => {
    if (params == null || typeof params !== "object") return;
    // Typed against the generated wire shape so a wire-field rename fails
    // typecheck here; the runtime guards stay because inbound payloads are
    // still untrusted bytes.
    const obj = params as Partial<EffectDisplacedEventParams>;
    const effect = optionalString(obj.effect);
    const displacedOwner = optionalString(obj.displaced_owner);
    // Only `effect` and `displaced_owner` are load-bearing — the first
    // identifies what was lost, the second is what this filter keys on. Their
    // absence means a payload this SDK cannot interpret, so drop it.
    if (effect === undefined || displacedOwner === undefined) return;
    // `new_owner` is Option<String> on the wire and may legitimately be null.
    // Requiring it dropped real displacement events that Go delivers with an
    // empty owner — the plugin never learned it had lost the effect at all.
    const newOwner = optionalString(obj.new_owner) ?? "";
    if (displacedOwner !== selfId) return;
    handler({ effect, newOwner, displacedOwner });
  });
};

/**
 * Optional<String> on the wire arrives as `unknown` (the TS emitter
 * routes Option<T> through `unknown`). Coerce to string-or-undefined.
 */
function optionalString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
