import { describe, it, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import { actingFor, getCurrentActor } from "../actor.js";

interface RpcLine {
  method?: string;
  on_behalf_of?: string;
  id?: number;
}

function captureStdout(): { lines: RpcLine[]; restore: () => void } {
  const lines: RpcLine[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: (c: unknown) => boolean }).write = (chunk: unknown) => {
    for (const part of String(chunk).split("\n")) {
      if (!part) continue;
      try {
        lines.push(JSON.parse(part) as RpcLine);
      } catch {
        /* ignore non-JSON */
      }
    }
    return true;
  };
  return {
    lines,
    restore: () => {
      (process.stdout as unknown as { write: typeof orig }).write = orig;
    },
  };
}

function shutdown(plugin: Plugin): void {
  (plugin as unknown as { shutdown: () => void }).shutdown();
}

describe("ambient actor store", () => {
  it("isolates concurrent async contexts", async () => {
    // A host runs many hosted things at once; one script's label must never
    // ride another's calls.
    const results = await Promise.all([
      actingFor("headphones.lua", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCurrentActor();
      }),
      actingFor("notes.js", async () => getCurrentActor()),
    ]);
    expect(results).toEqual(["headphones.lua", "notes.js"]);
    expect(getCurrentActor()).toBe("");
  });

  it("restores the outer label when a nested scope ends", () => {
    actingFor("headphones.lua", () => {
      actingFor("notes.js", () => {
        expect(getCurrentActor()).toBe("notes.js");
      });
      expect(getCurrentActor()).toBe("headphones.lua");
    });
    expect(getCurrentActor()).toBe("");
  });

  it("treats an empty actor as no label at all", () => {
    actingFor("", () => {
      expect(getCurrentActor()).toBe("");
    });
    actingFor(undefined, () => {
      expect(getCurrentActor()).toBe("");
    });
  });
});

describe("outbound envelope stamping", () => {
  it("stamps on_behalf_of on notifies made inside a scope", () => {
    const cap = captureStdout();
    const plugin = new Plugin();
    try {
      actingFor("headphones.lua", () => plugin.notify("test.ping", {}));
      plugin.notify("test.unlabeled", {});
    } finally {
      shutdown(plugin);
      cap.restore();
    }
    const labeled = cap.lines.find((l) => l.method === "test.ping");
    const bare = cap.lines.find((l) => l.method === "test.unlabeled");
    expect(labeled?.on_behalf_of).toBe("headphones.lua");
    // Absent, not empty — "no label" and "a blank label" must not be two states.
    expect(bare?.on_behalf_of).toBeUndefined();
  });
});
