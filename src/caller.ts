import { Methods } from "./methods_gen.js";

/**
 * Makes one platform RPC call. It is all a generated wrapper needs: a Plugin
 * is one, and a test can drive the wrappers over its own fake with
 * `methodsOver`, no transport needed.
 */
export interface Caller {
  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
}

/** The typed wrappers over any Caller. */
export function methodsOver(caller: Caller): Methods {
  return new CallerMethods(caller);
}

class CallerMethods extends Methods {
  constructor(private readonly caller: Caller) {
    super();
  }

  call<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    return this.caller.call<T>(method, params, timeoutMs);
  }
}
