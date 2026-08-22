/**
 * Settings-tab interaction idioms — the layer where every silent dead
 * button so far was born (DESIGN_SETTINGS_UI_ROBUSTNESS.md, leg 2).
 * Parity with plugin-sdk-go/ui. Each helper encodes a contract the
 * platform cannot check at runtime:
 *
 * - the element in an expression is `el`, never `$el` ($ reads a signal)
 * - page-local interaction state is a Datastar signal declared with
 *   __ifmissing (survives morphs) and CONSUMED by the action that uses it
 * - method URLs come from methodPost, never spelled by hand
 * - payload values are marshaled, never quote-spliced
 *
 * Plugins own look and layout: helpers accept class/style options and
 * return fragments. Hand-written Datastar remains a full escape hatch.
 */

import { methodPost } from "./settings_route.js";

/** Marks a raw Datastar/JS expression inside a payload — the deliberate
 * escape hatch from value marshaling. */
export class Expr {
  constructor(public readonly js: string) {}
}
export function expr(js: string): Expr {
  return new Expr(js);
}

/** "The value of the input immediately before this button" — the
 * input+Save pairing. `el` is the element; `$el` silently reads an
 * undefined signal. */
export const inputValue = new Expr("el.previousElementSibling.value");

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

export interface ButtonOptions {
  /** Payload as key → value; values are JSON-marshaled (quotes stay
   * data), Expr values embedded raw. */
  payload?: Record<string, unknown>;
  /** Raw JS object literal payload — escape hatch; caller owns escaping. */
  payloadJS?: string;
  /** Signal expression run AFTER the post (composed outside the payload —
   * "save, and close the form"). */
  then?: string;
  class?: string;
  style?: string;
}

export interface ConfirmOptions extends ButtonOptions {
  /** Second-click label (default "Really <label>?"). */
  confirmLabel?: string;
  /** State key override (default derives from method+payload). */
  key?: string;
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPayload(o: ButtonOptions): string {
  if (o.payloadJS !== undefined) return o.payloadJS;
  if (!o.payload) return "";
  const parts = Object.entries(o.payload).map(([k, v]) =>
    `${JSON.stringify(k)}:${v instanceof Expr ? v.js : JSON.stringify(v) ?? "null"}`,
  );
  return `{${parts.join(",")}}`;
}

function attrs(o: ButtonOptions): string {
  let out = "";
  if (o.class) out += ` class="${escapeHtml(o.class)}"`;
  if (o.style) out += ` style="${escapeHtml(o.style)}"`;
  return out;
}

function button(label: string, click: string, o: ButtonOptions): string {
  return `<button${attrs(o)} data-on:click="${escapeHtml(click)}">${escapeHtml(label)}</button>`;
}

/** Post to one of this plugin's methods on click. */
export function postButton(label: string, method: string, options: ButtonOptions = {}): string {
  let click = methodPost(method, buildPayload(options));
  if (options.then) click += `; ${options.then}`;
  return button(label, click, options);
}

/** Run a signal expression on click ("$renaming = true") — page-local UI
 * state, no server round-trip. */
export function signalButton(label: string, exprJS: string, options: ButtonOptions = {}): string {
  return button(label, exprJS, options);
}

/** Two-click destructive action: arm (page-local signal — one window's
 * half-finished delete never appears in another), confirm posts and
 * consumes the signal in one expression, Cancel disarms. */
export function confirmButton(label: string, method: string, options: ConfirmOptions = {}): string {
  const payload = buildPayload(options);
  const key = options.key ?? signalName(`${method}|${payload}`);
  const confirmLabel = options.confirmLabel ?? `Really ${label.toLowerCase()}?`;
  const sig = `$c_${key}`;
  const arm = button(label, `${sig} = true`, options);
  let confirmClick = `${methodPost(method, payload)}; ${sig} = false`;
  if (options.then) confirmClick += `; ${options.then}`;
  const danger: ButtonOptions = { ...options, style: `${options.style ?? ""}color:#c44;border-color:#c44;` };
  const confirm = button(confirmLabel, confirmClick, danger);
  const cancel = button("Cancel", `${sig} = false`, options);
  return (
    `<span data-signals:c_${key}__ifmissing="false">` +
    `<span data-show="!${sig}">${arm}</span>` +
    `<span data-show="${sig}" style="display:none;">${confirm}${cancel}</span>` +
    `</span>`
  );
}
