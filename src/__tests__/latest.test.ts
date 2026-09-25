import { describe, test, expect } from "bun:test";
import { Plugin } from "../plugin.js";

// A state stream — a stage stream declared `latest`, whose notifications the
// actuator marks `delivery: "latest"` — holds one place in the notification
// queue, newest value winning. The Go and Python SDKs do the same; the
// sdk-test coalescing case holds all three to it.
describe("state-stream notifications", () => {
  test("a busy listener is handed the newest value, not a backlog", async () => {
    const p = new Plugin();
    const gaze: number[] = [];
    const order: string[] = [];
    let release!: () => void;
    const busy = new Promise<void>((r) => {
      release = r;
    });
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    let started!: () => void;
    const listening = new Promise<void>((r) => {
      started = r;
    });

    p.on("ext.acme.gaze_point", async (params) => {
      const seq = (params as { seq: number }).seq;
      gaze.push(seq);
      order.push(`gaze:${seq}`);
      // The first position arrives while the listener is idle; hold it busy
      // while the rest of the stream arrives.
      if (gaze.length === 1) {
        started();
        await busy;
      }
    });
    p.on("ext.acme.blink", () => {
      order.push("blink");
      done();
    });
    void p.run();

    const origin = { source: "acme.gaze", onBehalfOf: "" };
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("ext.acme.gaze_point", { seq: 0 }, undefined, origin, "latest");
    await listening; // the listener is now busy with 0
    for (let i = 1; i < 100; i++) {
      // @ts-expect-error — enqueueNotification is private
      p.enqueueNotification("ext.acme.gaze_point", { seq: i }, undefined, origin, "latest");
    }
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("ext.acme.blink", {}, undefined, origin);
    release();
    await finished;

    expect(gaze).toEqual([0, 99]);
    expect(order).toEqual(["gaze:0", "gaze:99", "blink"]);
  });

  test("two senders of one type are two streams, and every other notification keeps its place", async () => {
    const p = new Plugin();
    const got: string[] = [];
    let done!: () => void;
    const finished = new Promise<void>((r) => {
      done = r;
    });
    p.on("tick", (params) => {
      got.push(`tick:${(params as { seq: number }).seq}`);
    });
    p.on("ext.acme.gaze_point", (params) => {
      got.push(`gaze:${(params as { seq: number }).seq}`);
    });
    p.on("end", () => done());

    // Queued before run(): nothing drains until readiness, so all of these
    // are waiting together.
    const left = { source: "left.tracker", onBehalfOf: "" };
    const right = { source: "right.tracker", onBehalfOf: "" };
    for (let i = 0; i < 3; i++) {
      // @ts-expect-error — enqueueNotification is private
      p.enqueueNotification("tick", { seq: i }, undefined);
    }
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("ext.acme.gaze_point", { seq: 1 }, undefined, left, "latest");
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("ext.acme.gaze_point", { seq: 2 }, undefined, right, "latest");
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("ext.acme.gaze_point", { seq: 3 }, undefined, left, "latest");
    // @ts-expect-error — enqueueNotification is private
    p.enqueueNotification("end", {}, undefined);
    void p.run();
    await finished;

    expect(got).toEqual(["tick:0", "tick:1", "tick:2", "gaze:3", "gaze:2"]);
  });
});
