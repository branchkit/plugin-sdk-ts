import { describe, test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PushCommands } from "../commands.js";

// We can't easily test PushCommands end-to-end (needs a running Plugin),
// but we can test the file loading and merging logic by importing the
// internal helpers indirectly through the module's behavior.

// Instead, test mergeRequiresTags logic via a round-trip:
// write fixture files, set BRANCHKIT_PLUGIN_DIR, and verify the commands
// that would be sent.

const FIXTURE_DIR = join(import.meta.dir, "__fixtures_commands__");

function setup() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

function teardown() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

describe("PushCommands file loading", () => {
  test("returns 0 when BRANCHKIT_PLUGIN_DIR is unset", async () => {
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    delete process.env.BRANCHKIT_PLUGIN_DIR;
    try {
      // Create a mock plugin that tracks calls
      const calls: any[] = [];
      const mockPlugin = {
        call: async (method: string, params: unknown) => {
          calls.push({ method, params });
          return { count: 0 };
        },
      };
      const count = await PushCommands(mockPlugin as any);
      expect(count).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      if (orig !== undefined) process.env.BRANCHKIT_PLUGIN_DIR = orig;
    }
  });

  test("loads base commands.json", async () => {
    setup();
    try {
      writeFileSync(
        join(FIXTURE_DIR, "commands.json"),
        JSON.stringify([
          { phrase: "hello", action: { type: "plugin", value: "test hello" } },
          { phrase: "world", action: { type: "plugin", value: "test world" } },
        ]),
      );

      const orig = process.env.BRANCHKIT_PLUGIN_DIR;
      process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
      try {
        let captured: any;
        const mockPlugin = {
          call: async (_method: string, params: unknown) => {
            captured = params;
            return { count: 2 };
          },
        };
        const count = await PushCommands(mockPlugin as any);
        expect(count).toBe(2);
        expect(captured.commands).toHaveLength(2);
        expect(captured.commands[0].phrase).toBe("hello");
      } finally {
        if (orig !== undefined) {
          process.env.BRANCHKIT_PLUGIN_DIR = orig;
        } else {
          delete process.env.BRANCHKIT_PLUGIN_DIR;
        }
      }
    } finally {
      teardown();
    }
  });

  test("loads context files and merges requires_tags", async () => {
    setup();
    try {
      // Empty base commands
      writeFileSync(join(FIXTURE_DIR, "commands.json"), "[]");

      // Context file
      mkdirSync(join(FIXTURE_DIR, "commands"), { recursive: true });
      writeFileSync(
        join(FIXTURE_DIR, "commands", "warp.json"),
        JSON.stringify({
          context: { requires_tags: ["app.dev.warp"] },
          commands: [
            { phrase: "split", action: { type: "plugin", value: "test split" } },
            {
              phrase: "tab",
              action: { type: "plugin", value: "test tab" },
              requires_tags: ["existing.tag"],
            },
          ],
        }),
      );

      const orig = process.env.BRANCHKIT_PLUGIN_DIR;
      process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
      try {
        let captured: any;
        const mockPlugin = {
          call: async (_method: string, params: unknown) => {
            captured = params;
            return { count: 2 };
          },
        };
        await PushCommands(mockPlugin as any);

        // Context tags should be prepended
        expect(captured.commands[0].requires_tags).toEqual(["app.dev.warp"]);
        // Existing tags should be preserved after context tags
        expect(captured.commands[1].requires_tags).toEqual([
          "app.dev.warp",
          "existing.tag",
        ]);
      } finally {
        if (orig !== undefined) {
          process.env.BRANCHKIT_PLUGIN_DIR = orig;
        } else {
          delete process.env.BRANCHKIT_PLUGIN_DIR;
        }
      }
    } finally {
      teardown();
    }
  });

  test("returns 0 when commands.json is missing and no context dir", async () => {
    setup();
    try {
      // No commands.json, no commands/ dir
      const orig = process.env.BRANCHKIT_PLUGIN_DIR;
      process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
      try {
        const calls: any[] = [];
        const mockPlugin = {
          call: async (method: string, params: unknown) => {
            calls.push({ method, params });
            return { count: 0 };
          },
        };
        const count = await PushCommands(mockPlugin as any);
        expect(count).toBe(0);
        // Should not have called grammar.push since there are no commands
        expect(calls).toHaveLength(0);
      } finally {
        if (orig !== undefined) {
          process.env.BRANCHKIT_PLUGIN_DIR = orig;
        } else {
          delete process.env.BRANCHKIT_PLUGIN_DIR;
        }
      }
    } finally {
      teardown();
    }
  });
});
