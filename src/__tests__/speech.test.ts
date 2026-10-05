// The speech engine runtime (serveSpeechEngineOn in src/stage.ts): one speak
// request in, one audio session out, closed by exactly one audio_stop
// whatever happened to it. The same cases as the Rust, Go and Python runtimes.
import { describe, test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { PipelineReader, PipelineWriter, type PipelineEvent } from "../pipeline.js";
import {
  Flow,
  serveSpeechEngineOn,
  type Capability,
  type SpeakCtx,
  type Speak,
  type SpeechEngine,
} from "../stage.js";

const cap: Capability = {
  stage_type: "tts",
  stage_name: "test",
  lifecycle_modes: ["persistent"],
} as Capability;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One 4-byte chunk per word, pausing between chunks the way synthesis
 * would. A word "fail" fails the utterance after its chunk. */
class WordEngine implements SpeechEngine {
  spoken: string[] = [];
  async speak(req: Speak, ctx: SpeakCtx): Promise<void> {
    this.spoken.push(req.session_id);
    await ctx.start({ rate: 16000, width: 2, channels: 1 });
    for (const word of req.text.split(/\s+/).filter(Boolean)) {
      if ((await ctx.audio(new Uint8Array(4))) === Flow.Stop) return;
      if (word === "fail") throw new Error("engine broke");
      await sleep(5);
    }
  }
}

const speak = (session: string, text: string): PipelineEvent => ({
  type: "speak",
  data: { session_id: session, text },
  payload: new Uint8Array(0),
});
const stop = (session: string): PipelineEvent => ({
  type: "audio_stop",
  data: { session_id: session },
  payload: new Uint8Array(0),
});

/** Serve `engine` with `events` written up front; stdin stays open for
 * `holdOpenMs` (so queued utterances get spoken), then EOF. */
async function runEngine(
  engine: SpeechEngine,
  events: PipelineEvent[],
  holdOpenMs = 200,
): Promise<PipelineEvent[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const w = new PipelineWriter(input);
  for (const ev of events) await w.writeEvent(ev);
  setTimeout(() => input.end(), holdOpenMs);
  const collected: Promise<PipelineEvent[]> = (async () => {
    const reader = new PipelineReader(output);
    const out: PipelineEvent[] = [];
    for (;;) {
      const ev = await reader.readEvent();
      if (ev === null) return out;
      out.push(ev);
    }
  })();
  await serveSpeechEngineOn(input, output, cap, engine);
  output.end();
  return collected;
}

const forSession = (evs: PipelineEvent[], session: string) =>
  evs
    .filter((e) => (e.data as Record<string, unknown> | undefined)?.session_id === session)
    .map((e) => e.type);

describe("serveSpeechEngine", () => {
  test("an utterance is start, chunks, stop on its session, and never credit", async () => {
    const out = await runEngine(new WordEngine(), [speak("u1", "snap left now")]);
    expect(out[0].type).toBe("capability");
    expect(forSession(out, "u1")).toEqual([
      "audio_start",
      "audio_chunk",
      "audio_chunk",
      "audio_chunk",
      "audio_stop",
    ]);
    expect(out.some((e) => e.type === "flow_credit")).toBe(false);
  });

  test("utterances are spoken in arrival order", async () => {
    const e = new WordEngine();
    await runEngine(e, [speak("a", "one"), speak("b", "two")]);
    expect(e.spoken).toEqual(["a", "b"]);
  });

  test("a cancel stops the utterance in progress", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const w = new PipelineWriter(input);
    const reader = new PipelineReader(output);
    const served = serveSpeechEngineOn(input, output, cap, new WordEngine()).then(() =>
      output.end(),
    );
    await w.writeEvent(speak("long", Array(200).fill("word").join(" ")));
    for (;;) {
      const ev = await reader.readEvent();
      if (ev?.type === "audio_chunk") break;
    }
    await w.writeEvent(stop("long"));
    const after: string[] = [];
    for (;;) {
      const ev = await reader.readEvent();
      after.push(ev!.type);
      if (ev!.type === "audio_stop") break;
    }
    expect(after.length).toBeLessThan(10);
    input.end();
    await served;
    const rest: PipelineEvent[] = [];
    for (;;) {
      const ev = await reader.readEvent();
      if (ev === null) break;
      rest.push(ev);
    }
    expect(forSession(rest, "long")).toEqual([]);
  });

  test("a queued utterance cancelled before it begins is closed unspoken", async () => {
    const e = new WordEngine();
    const out = await runEngine(
      e,
      [speak("a", "one two three four"), speak("b", "never"), stop("b")],
      300,
    );
    expect(e.spoken).toEqual(["a"]);
    expect(forSession(out, "b")).toEqual(["audio_stop"]);
  });

  test("a failed utterance reports an error, closes, and the next plays", async () => {
    const out = await runEngine(new WordEngine(), [speak("bad", "fail here"), speak("good", "fine")]);
    expect(forSession(out, "bad")).toEqual(["audio_start", "audio_chunk", "error", "audio_stop"]);
    expect(forSession(out, "good")).toEqual(["audio_start", "audio_chunk", "audio_stop"]);
  });

  test("unknown and malformed inbound is ignored", async () => {
    const e = new WordEngine();
    const out = await runEngine(e, [
      { type: "ext.acme.thing", data: { a: 1 }, payload: new Uint8Array(0) },
      { type: "speak", data: { no: "text" }, payload: new Uint8Array(0) },
      speak("ok", "hello"),
    ]);
    expect(e.spoken).toEqual(["ok"]);
    expect(forSession(out, "ok")).toEqual(["audio_start", "audio_chunk", "audio_stop"]);
  });
});
