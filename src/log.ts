/**
 * Write a log message to stderr with [pluginId] prefix (W7).
 * Stdout is reserved for JSON-RPC protocol messages.
 */
export function Log(pluginId: string, ...args: unknown[]): void {
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  process.stderr.write(`[${pluginId}] ${msg}\n`);
}
