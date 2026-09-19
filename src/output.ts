/**
 * Semantic output helpers — parity with plugin-sdk-go/output.go and
 * plugin-sdk-py/branchkit/output.py.
 *
 * The generated `plugin.outputState(state)` wrapper is the whole call; a
 * plugin states what is true for the person (`OutputState`, `OutputSection`,
 * `OutputItem` in types_gen.ts, `OutputKind*` / `OutputUrgency*` in
 * closed_vocab_gen.ts) and never sees a renderer. An item's `action` is one
 * of exactly two shapes; these build them so no producer hand-writes the
 * envelope, and so the three SDKs read the same.
 *
 * Design: docs/design/DESIGN_SEMANTIC_OUTPUT_CHANNEL.md.
 */
import type { OutputAction } from "./types_gen.js";

/** The action that injects `words` as if the person had spoken them —
 * routed through the same matcher their voice reaches, so confirming the
 * item is indistinguishable from saying it. The common case for a command. */
export function sayAction(words: string): OutputAction {
  return { say: words };
}

/** The action that dispatches `actionType` directly with `params` (omitted
 * when undefined) — for items that are not commands. */
export function dispatchAction(actionType: string, params?: unknown): OutputAction {
  return params === undefined ? { dispatch: actionType } : { dispatch: actionType, params };
}
