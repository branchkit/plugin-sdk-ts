import { describe, it, expect } from "bun:test";
import { CallTimeoutError, Plugin, RpcCallError } from "../plugin.js";

// A call that gets no answer rejects with a CallTimeoutError: typed, so a
// caller can tell "no answer" (the call may have happened) from a definite
// refusal (RpcCallError) without reading the message.
describe("call timeout", () => {
  it("rejects with a typed CallTimeoutError, not an RpcCallError", async () => {
    const orig = process.stdout.write.bind(process.stdout);
    // Swallow the outbound request; nothing answers it.
    (process.stdout as unknown as { write: (c: unknown) => boolean }).write = () => true;
    const plugin = new Plugin();
    let err: unknown;
    try {
      await plugin.call("collection.get", {}, 20);
    } catch (e) {
      err = e;
    } finally {
      (plugin as unknown as { shutdown: () => void }).shutdown();
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    }
    expect(err).toBeInstanceOf(CallTimeoutError);
    expect(err).not.toBeInstanceOf(RpcCallError);
    const timeout = err as CallTimeoutError;
    expect(timeout.method).toBe("collection.get");
    expect(timeout.timeoutMs).toBe(20);
    expect(timeout.message).toContain("timed out");
  });
});
