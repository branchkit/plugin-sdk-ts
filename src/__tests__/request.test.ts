// The request stage runtime (serveRequestsOn in src/stage.ts): every request
// gets exactly one reply carrying its id, in arrival order. The same cases as
// the Rust, Go and Python runtimes.
import { describe, test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { PipelineReader, PipelineWriter, type PipelineEvent } from "../pipeline.js";
import { serveRequestsOn, type Capability, type Reply, type RequestHandler } from "../stage.js";

const cap: Capability = {
  stage_type: "request",
  stage_name: "test",
  lifecycle_modes: ["persistent"],
} as Capability;

/** Upper-cases `body.text`; a body without one fails with "no text". */
const upper: RequestHandler = async (body) => {
  const text = (body as Record<string, unknown> | null)?.text;
  if (typeof text !== "string") throw new Error("no text");
  return { text: text.toUpperCase() };
};

const ev = (type: string, data: Record<string, unknown>): PipelineEvent => ({
  type,
  data,
  payload: new Uint8Array(0),
});

/** Serve `upper` with `events` written up front, then EOF. */
async function runRequests(events: PipelineEvent[]): Promise<PipelineEvent[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const w = new PipelineWriter(input);
  for (const e of events) await w.writeEvent(e);
  input.end();
  const collected: Promise<PipelineEvent[]> = (async () => {
    const reader = new PipelineReader(output);
    const out: PipelineEvent[] = [];
    for (;;) {
      const e = await reader.readEvent();
      if (e === null) return out;
      out.push(e);
    }
  })();
  await serveRequestsOn(input, output, cap, upper);
  output.end();
  return collected;
}

describe("serveRequests", () => {
  test("every request gets one reply with its id, in order", async () => {
    const out = await runRequests([
      ev("request", { request_id: "a", body: { text: "one" } }),
      ev("vocabulary_update", {}),
      ev("request", { request_id: "b", body: {} }),
      ev("request", { request_id: "c", body: { text: "three" } }),
    ]);
    expect(out[0].type).toBe("capability");
    const replies = out.slice(1).map((e) => {
      expect(e.type).toBe("reply");
      return e.data as unknown as Reply;
    });
    expect(replies.length).toBe(3);
    expect(replies[0].request_id).toBe("a");
    expect(replies[0].body).toEqual({ text: "ONE" });
    expect(replies[1].request_id).toBe("b");
    expect(replies[1].error).toBe("no text");
    expect(replies[1].body).toBeUndefined();
    expect(replies[2].body).toEqual({ text: "THREE" });
  });

  test("an unreadable request is an error event and serving continues", async () => {
    const out = await runRequests([
      ev("request", { body: { text: "no id" } }),
      ev("request", { request_id: "z", body: { text: "ok" } }),
    ]);
    expect(out[1].type).toBe("error");
    expect((out[1].data as Record<string, unknown>).code).toBe("bad_request");
    expect(out[2].type).toBe("reply");
    expect((out[2].data as Record<string, unknown>).request_id).toBe("z");
  });
});
