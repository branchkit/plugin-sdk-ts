import { AsyncLocalStorage } from "node:async_hooks";

// The actor label — who this plugin is acting *on behalf of*.
//
// A host-shaped plugin runs things the platform does not model: a scripting
// host runs script files, the browser plugin fronts an extension, an
// ambassador fronts an external app. Every platform call it makes is its
// own, over its own session, so audit rows, collection records, and events
// can name only the plugin. `actingFor` stamps the finer-grained label on
// the outbound envelope, and the platform carries it into what it writes.
//
// Observability only, by construction. The platform never consults the
// label for any decision — it cannot, because the host supplies it from
// inside its own process, so a lying host would only lie about a label it
// already had the grant to act under. Setting it widens nothing and narrows
// nothing; it makes the trail readable. Per-hosted-thing ENFORCEMENT would
// need real delegated identities, which is a different (unbuilt) feature.
//
// Scoped to the async context, exactly like the ambient correlation id:
// hosted things interleave, and a module-global would let one hosted
// thing's label ride another's calls.
const store = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `actor` as the ambient label on every RPC it makes.
 *
 * ```ts
 * await actingFor("headphones.lua", () => plugin.dispatch(action));
 * ```
 *
 * An empty actor runs `fn` with no label rather than an empty one — a host
 * with nothing to declare needs no special case. Nested calls restore the
 * outer label when the inner scope ends, so one hosted thing invoking
 * another leaves the trail intact.
 */
export function actingFor<T>(actor: string | undefined, fn: () => T): T {
  if (!actor) return fn();
  return store.run(actor, fn);
}

/** The actor label outbound calls currently carry, or "" if none. */
export function getCurrentActor(): string {
  return store.getStore() ?? "";
}
