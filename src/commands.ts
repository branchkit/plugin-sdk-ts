import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "./plugin.js";

/**
 * Context file format: a context-scoped command file.
 *
 * ```json
 * {
 *   "context": { "requires_tags": ["app.dev.warp.Warp-Stable"] },
 *   "commands": [ ... ]
 * }
 * ```
 */
interface ContextFile {
  context: { requires_tags: string[] };
  commands: Record<string, unknown>[];
}

/**
 * Load commands.json and any context files from commands/,
 * then push them all to the actuator via commands.push.
 *
 * File layout:
 *
 * ```
 * $BRANCHKIT_PLUGIN_DIR/
 *   commands.json              ← base commands (no context)
 *   commands/                  ← optional directory of context files
 *     warp.json               ← context-scoped commands
 *     terminal.json
 * ```
 *
 * Commands in a context file inherit the context's requires_tags
 * (merged with any requires_tags on the command itself).
 *
 * Returns the number of command variants registered.
 */
export async function PushCommands(plugin: Plugin): Promise<number> {
  const pluginDir = process.env.BRANCHKIT_PLUGIN_DIR;
  if (!pluginDir) return 0;

  const allCommands: Record<string, unknown>[] = [];

  // Load base commands.json
  const base = loadCommandFile(join(pluginDir, "commands.json"));
  allCommands.push(...base);

  // Load context files from commands/ directory (if it exists)
  const contextDir = join(pluginDir, "commands");
  let entries: string[];
  try {
    entries = readdirSync(contextDir).filter((e) => e.endsWith(".json")).sort();
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    const cmds = loadContextFile(join(contextDir, entry));
    allCommands.push(...cmds);
  }

  if (allCommands.length === 0) return 0;

  const resp = await plugin.call<{ count: number }>("commands.push", {
    commands: allCommands,
  });
  return resp.count;
}

function loadCommandFile(path: string): Record<string, unknown>[] {
  let data: string;
  try {
    data = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  return JSON.parse(data);
}

function loadContextFile(path: string): Record<string, unknown>[] {
  const data = readFileSync(path, "utf-8");
  const cf: ContextFile = JSON.parse(data);

  if (!cf.context?.requires_tags?.length) {
    throw new Error(`${path}: missing or empty context.requires_tags`);
  }
  if (!cf.commands?.length) return [];

  return cf.commands.map((cmd) => mergeRequiresTags(cmd, cf.context.requires_tags));
}

/**
 * Add contextTags to a command's requires_tags field.
 * If the command already has requires_tags, the context tags are prepended.
 */
function mergeRequiresTags(
  cmd: Record<string, unknown>,
  contextTags: string[],
): Record<string, unknown> {
  const existing = (cmd.requires_tags as string[] | undefined) ?? [];
  return {
    ...cmd,
    requires_tags: [...contextTags, ...existing],
  };
}
