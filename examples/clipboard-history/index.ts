/**
 * Clipboard History — example BranchKit plugin using the TypeScript SDK.
 *
 * Demonstrates:
 *   - Action handling (on_action)
 *   - Typed method wrappers (inputClipboardRead, storePush, hudPush)
 *   - Notification listeners (_platform.app.focused)
 *   - PushCommands for voice command registration
 *   - Settings tab rendering
 */

import {
  Plugin,
  PushCommands,
  Log,
  EventAppFocused,
  HookOnAction,
  HookRenderSettings,
} from "@branchkit/plugin-sdk-ts";

const plugin = new Plugin();
const pluginId = process.env.BRANCHKIT_PLUGIN_ID ?? "clipboard-history";

// In-memory clipboard history (most recent first)
interface ClipEntry {
  text: string;
  app: string;
  timestamp: number;
}
const history: ClipEntry[] = [];
const MAX_HISTORY = 50;
let lastApp = "";

// --- Notification listeners ---

// Track which app is focused (for attributing clipboard entries)
plugin.on(EventAppFocused, (params) => {
  const { bundle_id } = params as { bundle_id: string };
  lastApp = bundle_id;
});

// --- Request handlers ---

plugin.handle(HookOnAction, async (params) => {
  const { action } = params as { action: string };

  switch (action) {
    case "clipboard paste_previous": {
      if (history.length < 2) {
        return { status: "ok" };
      }
      // Write the second-most-recent entry back to clipboard
      const prev = history[1];
      await plugin.inputClipboardWrite("public.utf8-plain-text", prev.text);
      Log(pluginId, `pasted previous: ${prev.text.slice(0, 40)}...`);
      return { status: "ok" };
    }

    case "clipboard show_history": {
      // Push history to HUD
      const items = history.slice(0, 10).map((entry, i) => ({
        id: String(i),
        title: entry.text.slice(0, 60),
        subtitle: entry.app,
      }));
      await plugin.hudPush("main", [
        { title: "Clipboard History", items },
      ]);
      return { status: "ok" };
    }

    case "clipboard clear": {
      history.length = 0;
      Log(pluginId, "history cleared");
      return { status: "ok" };
    }

    default:
      return { status: "not_handled" };
  }
});

plugin.handle(HookRenderSettings, async (params) => {
  const { tab_key } = params as { tab_key: string };
  if (tab_key !== "history") {
    return { html: "" };
  }

  const rows = history
    .slice(0, 20)
    .map(
      (e) =>
        `<tr><td>${escapeHtml(e.text.slice(0, 80))}</td><td>${escapeHtml(e.app)}</td></tr>`,
    )
    .join("");

  return {
    html: `
      <h3>Recent Clipboard Entries</h3>
      <table>
        <thead><tr><th>Text</th><th>Source App</th></tr></thead>
        <tbody>${rows || "<tr><td colspan=2>No entries yet</td></tr>"}</tbody>
      </table>
    `,
  };
});

// --- Clipboard polling ---

// Poll clipboard for changes (simple interval-based approach)
let lastChangeCount = -1;

async function pollClipboard() {
  try {
    const current = await plugin.nativeClipboardChangeCount();
    if (current.count === lastChangeCount) return;
    lastChangeCount = current.count ?? -1;

    const clip = await plugin.inputClipboardRead("public.utf8-plain-text");
    if (!clip.text) return;

    // Don't duplicate the most recent entry
    if (history.length > 0 && history[0].text === clip.text) return;

    history.unshift({ text: clip.text, app: lastApp, timestamp: Date.now() });
    if (history.length > MAX_HISTORY) history.pop();

    // Persist to store for other plugins to read
    await plugin.storePush("clipboard_history", JSON.stringify(history.slice(0, 10)));
  } catch {
    // Clipboard read can fail during transitions — ignore
  }
}

setInterval(pollClipboard, 1000);

// --- Start ---

await PushCommands(plugin);
Log(pluginId, `loaded ${history.length} history entries`);
await plugin.run();

// --- Helpers ---

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
