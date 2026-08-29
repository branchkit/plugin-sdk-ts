import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "./plugin.js";
import type { CommandSpec } from "./types_gen.js";

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

/**
 * An ABSENT file is not an error — a plugin may ship only context files under
 * commands/, or no command files at all. Any other read failure propagates:
 * this used to swallow every error and return `[]`, so an unreadable or
 * permission-denied commands.json silently pushed zero commands.
 */
function loadCommandFile(path: string): Record<string, unknown>[] {
  let data: string;
  try {
    data = readFileSync(path, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw new Error(
      `${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
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

// =============================================================================
// Command authoring builder.
//
// Codegen emits `CommandSpec` with `unknown` `pattern` / `action` fields (the
// same quirk the `listOpts` builder smooths over), so constructing a command
// by hand means writing JSON literals inline. This builder produces a
// `CommandSpec` with first-class pattern slots — and exposes the actuator's
// alternatives capability (`oneOf`) that no authoring surface reached before.
//
//   command(oneOf("refresh", "reload"))
//     .action("browser.refresh")
//     .requiresTags("plugin.browser.active")
//     .category("Navigation")
//     .build();
//
//   command(word("focus"), capture("app", "apps"))
//     .action("input.focus_app")
//     .build();
//
// Pair with loadCommands (file → CommandSpec[], no push) and pushCommandSpecs
// (typed push) to union static, file-authored commands with built dynamic
// ones and push them in a single call.
// =============================================================================

/** One position in a command pattern: a literal word or an alternatives group. */
export type PatternSlot = string | string[];

/** A literal spoken word. */
export function word(w: string): PatternSlot {
  return w;
}

/** An alternatives slot: any of the given words matches, sharing one action. */
export function oneOf(...alts: string[]): PatternSlot {
  return alts;
}

/**
 * A list-capture token `<name:collection>` whose matched value binds to
 * `name`. An empty name uses the collection as the binding name.
 */
export function capture(name: string, collection: string): PatternSlot {
  return name ? `<${name}:${collection}>` : `<${collection}>`;
}

/** A free-text capture token `<name:text>` (or `<text>` when name is omitted). */
export function text(name?: string): PatternSlot {
  return name ? `<${name}:text>` : "<text>";
}

/**
 * Prefix-discovery modes for {@link CommandBuilder.discovery}.
 * See docs/design/DESIGN_DISCOVERABLE_PREFIX.md.
 *
 * - `"prefix"` — the bare prefix opens the HUD; the capture's words stay live in
 *   free context (small, acoustically safe target sets).
 * - `"exclusive"` — the bare prefix enters an auto-minted exclusive mode so the
 *   capture's words only decode while it holds (large/dynamic sets, e.g. tabs).
 */
export type DiscoveryMode = "prefix" | "exclusive";

/** Accumulates a CommandSpec via chained setters; finish with build(). */
export class CommandBuilder {
  private spec: CommandSpec;

  constructor(slots: PatternSlot[]) {
    this.spec = {
      pattern: slots,
      cancels_bridge: false,
      requires_tags: [],
      sets_tags: [],
      clears_tags: [],
      sets_on_partial: [],
      display_sources: {},
      variants: [],
    };
  }

  /**
   * Set the action fired on match. `type` is the action's type (a built-in
   * like "key" or a dotted plugin action like "browser.refresh"); optional
   * `params` are merged into the action object.
   */
  action(type: string, params?: Record<string, unknown>): this {
    this.spec.action = { type, ...(params ?? {}) };
    return this;
  }

  requiresTags(...tags: string[]): this {
    this.spec.requires_tags.push(...tags);
    return this;
  }

  setsTags(...tags: string[]): this {
    this.spec.sets_tags.push(...tags);
    return this;
  }

  clearsTags(...tags: string[]): this {
    this.spec.clears_tags.push(...tags);
    return this;
  }

  /**
   * Discovery-HUD display override for one capture: enumerate `collection`
   * in the HUD instead of the capture's matching collection. Matching is
   * untouched — pair a sealed/static matching collection with a live menu.
   * (docs/design/DESIGN_CAPTURE_DISPLAY_FORMS.md, part A.)
   */
  displaySource(capture: string, collection: string): this {
    this.spec.display_sources[capture] = collection;
    return this;
  }

  setsOnPartial(...tags: string[]): this {
    this.spec.sets_on_partial.push(...tags);
    return this;
  }

  cancelsBridge(): this {
    this.spec.cancels_bridge = true;
    return this;
  }

  /**
   * Declare the command's prefix-discovery affordance (see {@link DiscoveryMode}):
   * the bare literal prefix of a `prefix + tail-capture` pattern opens the
   * Discovery HUD when spoken alone, instead of firing. Valid only on a
   * literal-prefix + single-tail-capture pattern; the actuator rejects other
   * shapes at load. See docs/design/DESIGN_DISCOVERABLE_PREFIX.md.
   */
  discovery(mode: DiscoveryMode): this {
    this.spec.discovery = mode;
    return this;
  }

  category(c: string): this {
    this.spec.category = c;
    return this;
  }

  description(d: string): this {
    this.spec.description = d;
    return this;
  }

  build(): CommandSpec {
    return this.spec;
  }
}

/** Start a command builder with the given pattern slots. */
export function command(...slots: PatternSlot[]): CommandBuilder {
  return new CommandBuilder(slots);
}

/**
 * Load commands.json and any context files from commands/ into CommandSpec[]
 * WITHOUT pushing. Splitting load from push (vs. PushCommands, which does
 * both) lets a plugin union file-authored static commands with built dynamic
 * ones and push them in a single pushCommandSpecs call.
 */
export function loadCommands(): CommandSpec[] {
  const pluginDir = process.env.BRANCHKIT_PLUGIN_DIR;
  if (!pluginDir) return [];

  const raw: Record<string, unknown>[] = [];
  raw.push(...loadCommandFile(join(pluginDir, "commands.json")));

  let entries: string[];
  try {
    entries = readdirSync(join(pluginDir, "commands"))
      .filter((e) => e.endsWith(".json"))
      .sort();
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    raw.push(...loadContextFile(join(pluginDir, "commands", entry)));
  }

  return raw as unknown as CommandSpec[];
}

// The actuator's command parser rejects an explicit JSON `null` for these
// array fields (it accepts an array or an absent field). The builder defaults
// them to [], but a spec from loadCommands carries whatever the file had — so
// coerce null/undefined to [] before the wire. Mirrors Go's
// normalizeCommandSpec; keeps the two SDKs at parity for hand-authored files.
const COMMAND_SPEC_ARRAY_FIELDS = [
  "requires_tags",
  "sets_tags",
  "clears_tags",
  "sets_on_partial",
  "variants",
] as const;

function normalizeCommandSpec(spec: CommandSpec): CommandSpec {
  const out: Record<string, unknown> = { ...spec };
  for (const field of COMMAND_SPEC_ARRAY_FIELDS) {
    if (out[field] == null) {
      out[field] = [];
    }
  }
  return out as unknown as CommandSpec;
}

/**
 * Register a built/loaded set of commands with the actuator via commands.push
 * (replace-per-plugin semantics). Sibling to PushCommands, which loads and
 * pushes files in one step. Returns the number of command variants registered.
 */
export async function pushCommandSpecs(
  plugin: Plugin,
  specs: CommandSpec[],
): Promise<number> {
  const resp = await plugin.call<{ count: number }>("commands.push", {
    commands: specs.map(normalizeCommandSpec),
  });
  return resp.count;
}

/**
 * Register `specs` as a NAMED GROUP within this plugin's command set,
 * replacing only that group and leaving the plugin's other groups intact.
 *
 * Use this whenever a plugin has more than one command source. Plain
 * {@link pushCommandSpecs} replaces the plugin's ENTIRE set, so two sources
 * pushing independently race: whichever landed last is the only set the
 * matcher sees. That is not hypothetical — it cost the browser plugin its
 * hint-skeleton commands repeatedly, and the workaround was a mutex plus
 * rebuilding the union from every builder on each call. With groups, each
 * source owns one and nothing needs to know about the others.
 *
 * ```ts
 * // each source owns its own group; no coordination between them
 * await pushCommandGroup(plugin, "hints", hintSpecs);
 * await pushCommandGroup(plugin, "scroll", scrollSpecs);
 *
 * // retract one source without touching the rest
 * await pushCommandGroup(plugin, "hints", []);
 * ```
 *
 * Returns the number of command variants now active for the whole plugin, not
 * just this group.
 */
export async function pushCommandGroup(
  plugin: Plugin,
  group: string,
  specs: CommandSpec[],
): Promise<number> {
  // Refused locally rather than sent: an empty group name is
  // indistinguishable on the wire from an ungrouped push, which replaces
  // EVERY group. A caller must not reach whole-set semantics by accident.
  if (!group) {
    throw new Error(
      "pushCommandGroup: group name is required (use pushCommandSpecs to replace the whole set)",
    );
  }
  const resp = await plugin.call<{ count: number }>("commands.push", {
    commands: specs.map(normalizeCommandSpec),
    group,
  });
  return resp.count;
}
