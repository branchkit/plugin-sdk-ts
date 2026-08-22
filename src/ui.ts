/**
 * Settings-tab interaction idioms — the layer where every silent dead
 * button so far was born (DESIGN_SETTINGS_UI_ROBUSTNESS.md, leg 2).
 * Parity with plugin-sdk-go/ui. Each helper encodes a contract the
 * platform cannot check at runtime:
 *
 * - the element in an expression is `el`, never `$el` ($ reads a signal)
 * - page-local interaction state is a Datastar signal declared with
 *   __ifmissing (survives morphs) and CONSUMED by the action that uses
 *   it (signals outlive rows)
 * - method URLs come from methodPost, never spelled by hand
 *
 * Plugins own look and layout; helpers take a `style` string and return
 * fragments. Hand-written Datastar remains a full escape hatch.
 */

import { methodPost } from "./settings_route.js";

/** "The value of the input immediately before this button" — the
 * input+Save pairing. `el` is the element; `$el` silently reads an
 * undefined signal. */
export const inputValue = "el.previousElementSibling.value";

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Sanitize an arbitrary seed for use inside a Datastar signal
 * identifier: alnum+underscore, with an fnv32 suffix so distinct seeds
 * that sanitize alike cannot share state. */
export function signalName(seed: string): string {
  const clean = seed.replace(/[^a-zA-Z0-9]/g, "_");
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${clean}_${h.toString(16)}`;
}

function button(label: string, click: string, style: string): string {
  return `<button style="${escapeHtml(style)}" data-on:click="${escapeHtml(click)}">${escapeHtml(label)}</button>`;
}

/** Post to one of this plugin's methods on click. payloadJS is a JS
 * object literal ("" for none) — embedded verbatim; escape untrusted
 * values yourself, same as methodPost. */
export function postButton(label: string, method: string, payloadJS: string, style: string): string {
  return button(label, methodPost(method, payloadJS), style);
}

/** Run a signal expression on click ("$renaming = true") — page-local
 * UI state, no server round-trip. */
export function signalButton(label: string, exprJS: string, style: string): string {
  return button(label, exprJS, style);
}

/** Post, then run a signal expression — the consume-on-use composition
 * ("save, and close the form"). Composing by hand invites putting the
 * expression inside the payload object — a syntax error that kills the
 * button silently. */
export function postButtonThen(
  label: string,
  method: string,
  payloadJS: string,
  thenJS: string,
  style: string,
): string {
  return button(label, `${methodPost(method, payloadJS)}; ${thenJS}`, style);
}

/** Two-click destructive action: arm (page-local signal — one window's
 * half-finished delete never appears in another), confirm posts AND
 * consumes the signal in one expression, Cancel disarms. `key` scopes
 * the state — use the row's identity, e.g. signalName(name). */
export function confirmPostButton(
  key: string,
  label: string,
  confirmLabel: string,
  method: string,
  payloadJS: string,
  style: string,
): string {
  const sig = `$c_${key}`;
  const arm = button(label, `${sig} = true`, style);
  const confirm = button(
    confirmLabel,
    `${methodPost(method, payloadJS)}; ${sig} = false`,
    `${style}color:#c44;border-color:#c44;`,
  );
  const cancel = button("Cancel", `${sig} = false`, style);
  return (
    `<span data-signals:c_${key}__ifmissing="false">` +
    `<span data-show="!${sig}">${arm}</span>` +
    `<span data-show="${sig}" style="display:none;">${confirm}${cancel}</span>` +
    `</span>`
  );
}
