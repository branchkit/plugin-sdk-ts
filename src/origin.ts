import { AsyncLocalStorage } from "node:async_hooks";

// Who sent the event notification a listener is handling.
//
// The platform delivers an event to every plugin whose manifest subscription
// matches it, and the event type alone does not say who emitted it: a
// subscription to `*.focused` hears every plugin's `focused`, and a host that
// relays its hosted things' events wants to know the event really came from
// itself. The actuator puts the sender on the notification's envelope, and
// the SDK makes it readable from inside the listener — the same ambient shape
// as the correlation id, so no listener signature changes.
//
// Scoped to the async context of one delivery with `AsyncLocalStorage`, like
// the correlation id: listeners are async, and a module global would let one
// delivery read another's sender.

/** The sender of an event notification, as the platform delivered it. */
export interface EventOrigin {
  /**
   * The emitter the platform authenticated: a plugin id, `"_platform"` for
   * platform events, or a stage's name for `ext.*` events. The platform
   * force-sets it from the emitting connection, so a listener can trust it.
   * `""` outside an event listener, or from an actuator that predates it.
   */
  source: string;
  /**
   * The emitter's actor label — which hosted thing it said it was acting for
   * (see `actingFor`), or `""` if none. A CLAIM by `source`, never checked by
   * the platform: trust it exactly as far as you trust `source`.
   */
  onBehalfOf: string;
}

const NONE: EventOrigin = Object.freeze({ source: "", onBehalfOf: "" });

const store = new AsyncLocalStorage<EventOrigin>();

/**
 * Run `fn` with `origin` as the ambient event origin for its async context.
 * An empty origin runs `fn` with none rather than entering a blank scope.
 */
export function runWithEventOrigin<T>(origin: EventOrigin, fn: () => T): T {
  if (!origin.source && !origin.onBehalfOf) return fn();
  return store.run(origin, fn);
}

/**
 * The sender of the event notification being handled in the current async
 * context — inside `on` and `onPattern` listeners — or an empty origin when
 * none is in flight (request handlers, and work outside a delivery).
 */
export function getCurrentEventOrigin(): EventOrigin {
  return store.getStore() ?? NONE;
}
