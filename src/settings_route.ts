/**
 * The one route the actuator serves for settings-UI → plugin method calls
 * (`/v1/plugins/{plugin_id}/methods/{*method_path}`). Hand-writing this
 * shape in template literals is how four plugins ended up with dead
 * settings tabs — the segment lives here so there is one spelling of it.
 * TS twin of the Go SDK's MethodURL / MethodPost.
 */

const METHOD_ROUTE_PREFIX = "/v1/plugins/";

/**
 * The settings-UI route that invokes `method` on this plugin. The plugin id
 * comes from BRANCHKIT_PLUGIN_ID (set by the actuator at spawn), so a
 * renamed plugin cannot desync its own URLs.
 *
 * The actuator normalizes `-` and `/` to `_` before dispatch, so
 * methodURL("set-gap") and methodURL("set_gap") both reach the handler
 * registered as `set_gap`.
 */
export function methodURL(method: string): string {
  const id = process.env.BRANCHKIT_PLUGIN_ID || "unknown";
  return `${METHOD_ROUTE_PREFIX}${id}/methods/${method.replace(/^\//, "")}`;
}

/**
 * The Datastar `@post(...)` expression that invokes `method` on this
 * plugin, for a `data-on:click` attribute.
 *
 * `payloadJS` is a JavaScript object literal for the request params, or ""
 * for a method that takes none. It is embedded verbatim — escape
 * user-controlled strings before building it, as with any inline
 * expression.
 */
export function methodPost(method: string, payloadJS = ""): string {
  if (!payloadJS) {
    return `@post('${methodURL(method)}')`;
  }
  return `@post('${methodURL(method)}', {payload: ${payloadJS}})`;
}
