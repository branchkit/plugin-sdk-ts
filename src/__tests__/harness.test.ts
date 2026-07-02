import { describe, test, expect } from "bun:test";
import { Harness, harnessBinaryAvailable } from "../harness.js";

const HELLOWORLD_DIR = new URL(
  "../../../plugins/helloworld",
  import.meta.url,
).pathname;

// These are integration tests that drive the Rust `branchkit-test-harness`
// binary. It isn't built (or reachable) from this SDK's standalone checkout, so
// skip when absent — they run in the app-repo conformance context where the
// binary exists. See harnessBinaryAvailable().
describe.skipIf(!harnessBinaryAvailable())("Harness", () => {
  test("start and get plugin state", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const state = await h.getPluginState();
      expect(state.alive).toBe(true);
      expect(state.plugin_id).toBe("helloworld");
    } finally {
      await h.stop();
    }
  });

  test("simulate command tie surfaced", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      // "hello branchkit" completes BOTH helloworld commands at the same
      // length (the ["hello","branchkit"] literal and the ["hello","<text>"]
      // capture). Equally-eligible same-length candidates are a genuine tie:
      // the matcher declines to act and surfaces the tied set for
      // disambiguation (DESIGN_MATCHER_COLLISION_RESOLUTION step 2).
      const result = await h.simulateCommand("hello branchkit");
      expect(result.matched).toBe(false);
      expect(result.tied_candidates?.length).toBe(2);
      for (const c of result.tied_candidates ?? []) {
        expect(c.owner_plugin).toBe("helloworld");
      }
    } finally {
      await h.stop();
    }
  });

  test("simulate command no match", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const result = await h.simulateCommand("this will not match anything");
      expect(result.matched).toBe(false);
    } finally {
      await h.stop();
    }
  });

  test("parameterized command", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const result = await h.mustSimulateCommand("hello world");
      const params = result.actionParams<{ name: string }>();
      expect(params.name).toBe("world");
    } finally {
      await h.stop();
    }
  });

  test("tag set/get/clear", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      await h.setTag("test.example.tag");
      await h.requireTag("test.example.tag");

      const tags = await h.getTags("test.example.*");
      expect(tags).toEqual(["test.example.tag"]);

      await h.clearTag("test.example.tag");
      await h.requireNoTag("test.example.tag");
    } finally {
      await h.stop();
    }
  });

  test("reset clears state", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      await h.setTag("test.before.reset");
      await h.requireTag("test.before.reset");

      await h.reset();

      await h.requireNoTag("test.before.reset");
      const state = await h.getPluginState();
      expect(state.alive).toBe(true);
    } finally {
      await h.stop();
    }
  });
});
