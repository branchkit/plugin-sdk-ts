import { AsyncLocalStorage } from "node:async_hooks";

// Ambient inbound-correlation tracking.
//
// The actuator carries correlation in a thread-local read via
// `correlation::current()` and stamps every event it emits from the live
// scope. The TS SDK mirrors that so a handler can thread the inbound id
// forward without any signature change. JS is single-threaded but handlers
// are async and interleave, so a module-global would let one invocation read
// a sibling's id; `AsyncLocalStorage` keys the value to the async context of
// each handler/listener invocation instead.
const store = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `id` as the ambient inbound correlation for the duration of
 * its async context. A falsy id runs `fn` with no ambient (clears any inherited
 * value would-be — we simply don't enter a scope).
 */
export function runWithCorrelation<T>(id: string | undefined, fn: () => T): T {
  if (!id) return fn();
  return store.run(id, fn);
}

/** The inbound correlation id for the current async context, or "" if none. */
export function getCurrentCorrelation(): string {
  return store.getStore() ?? "";
}
