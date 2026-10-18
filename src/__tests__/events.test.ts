import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";
import {
  EventCollectionUpdated,
  EventPowerChanged,
  EventSystemWillSleep,
} from "../contracts_gen.js";
import type { CollectionUpdatedEventParams } from "../types_gen.js";

// The typed event helpers (events_gen.ts): one per platform event, tying its
// name to its generated payload type. Driven through the real notification
// pump, as effects.test.ts does.

async function deliver(p: Plugin, event: string, params: unknown): Promise<void> {
  // @ts-expect-error — enqueueNotification is private
  p.enqueueNotification(event, params);
  await new Promise((r) => setTimeout(r, 0));
}

function running(): Plugin {
  const p = new Plugin();
  // The pump holds delivery until run(), as in effects.test.ts.
  void p.run();
  return p;
}

describe("typed event helpers", () => {
  test("a data event hands over its payload", async () => {
    const p = running();
    const seen: CollectionUpdatedEventParams[] = [];
    p.onCollectionUpdated((evt) => {
      seen.push(evt);
    });
    await deliver(p, EventCollectionUpdated, { collection: "keyboard.keys", writer: "keyboard" });
    expect(seen).toEqual([{ collection: "keyboard.keys", writer: "keyboard" }]);
  });

  test("a signal and an empty event take no argument", async () => {
    const p = running();
    const args: number[] = [];
    p.onPowerChanged((...a: unknown[]) => {
      args.push(a.length);
    });
    p.onSystemWillSleep((...a: unknown[]) => {
      args.push(a.length);
    });
    await deliver(p, EventPowerChanged, { on_battery: true });
    await deliver(p, EventSystemWillSleep, undefined);
    expect(args).toEqual([0, 0]);
  });
});
