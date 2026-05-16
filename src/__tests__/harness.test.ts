import { describe, test, expect } from "bun:test";
import { Harness } from "../harness.js";

const HELLOWORLD_DIR = new URL(
  "../../../plugins/helloworld",
  import.meta.url,
).pathname;

describe("Harness", () => {
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

  test("simulate command match", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const result = await h.mustSimulateCommand("hello branchkit");
      expect(result.actionType()).toBe("helloworld.greet");

      const params = result.actionParams<{ name: string }>();
      expect(params.name).toBe("BranchKit");
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
