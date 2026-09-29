// The stage runtime (src/stage.ts): credit cadence, the BKLOG1 structured
// log line, and the audio-consumer loop's exact output sequence. The credit
// and log cases are the Python SDK's TestCredit / TestStageLog one for one;
// the runtime case is the Go SDK's per-session grant test. A wrong credit
// number starves or floods the platform's window, and a malformed log line
// loses its session correlation — both silently — so these pin the bytes.
import { describe, test, expect, afterEach } from "bun:test";
import { PassThrough } from "node:stream";
import { PipelineReader, PipelineWriter, type PipelineEvent } from "../pipeline.js";
import {
  BaseConsumer,
  Chunk,
  CreditGranter,
  Flow,
  InitialGrant,
  clearLogSession,
  logError,
  logInfo,
  logWarn,
  serveAudioConsumerOn,
  setLogSession,
  type AudioChunk,
  type AudioCtx,
  type AudioStop,
  type Capability,
} from "../stage.js";

/** Every event written to `stream` once it has ended. */
async function drain(stream: PassThrough): Promise<PipelineEvent[]> {
  const reader = new PipelineReader(stream);
  const out: PipelineEvent[] = [];
  for (;;) {
    const ev = await reader.readEvent();
    if (ev === null) return out;
    out.push(ev);
  }
}

function credits(evs: PipelineEvent[]): Array<[string, number]> {
  return evs.map((ev) => {
    expect(ev.type).toBe("flow_credit");
    const d = ev.data as { session_id: string; frames: number };
    return [d.session_id, d.frames];
  });
}

describe("CreditGranter", () => {
  test("cadence: initial window, then one grant per `every` chunks", async () => {
    const out = new PassThrough();
    const w = new PipelineWriter(out);
    const g = new CreditGranter(3, 10);
    await g.grantNow(w, "s1", 5);
    for (let i = 0; i < 7; i++) await g.onChunk(w, "s1");
    out.end();
    // initial window, then one grant per three chunks (7 -> 2)
    expect(credits(await drain(out))).toEqual([
      ["s1", 5],
      ["s1", 10],
      ["s1", 10],
    ]);
  });

  test("grantNow resets the cadence counter", async () => {
    const out = new PassThrough();
    const w = new PipelineWriter(out);
    const g = new CreditGranter(3, 10);
    await g.onChunk(w, "s1");
    await g.onChunk(w, "s1"); // one short of a grant
    await g.grantNow(w, "s1", 4);
    await g.onChunk(w, "s1");
    await g.onChunk(w, "s1"); // would have granted without the reset
    out.end();
    expect(credits(await drain(out))).toEqual([["s1", 4]]);
  });

  test("every = 0 never grants", async () => {
    const out = new PassThrough();
    const w = new PipelineWriter(out);
    const g = new CreditGranter(0, 10);
    for (let i = 0; i < 100; i++) await g.onChunk(w, "s1");
    out.end();
    expect(await drain(out)).toEqual([]);
  });

  test("the counter survives sessions", async () => {
    // Deliberate: a per-session reset comes from grantNow, not from here.
    const out = new PassThrough();
    const w = new PipelineWriter(out);
    const g = new CreditGranter(3, 1);
    await g.onChunk(w, "s1");
    await g.onChunk(w, "s1");
    await g.onChunk(w, "s2");
    out.end();
    expect(credits(await drain(out))).toEqual([["s2", 1]]);
  });
});

describe("stage log", () => {
  const realWrite = process.stderr.write.bind(process.stderr);
  let captured = "";

  function capture(fn: () => void): string {
    captured = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    }) as typeof process.stderr.write;
    try {
      fn();
    } finally {
      process.stderr.write = realWrite;
    }
    return captured;
  }

  afterEach(() => {
    process.stderr.write = realWrite;
    clearLogSession();
  });

  test("prefix and session", () => {
    setLogSession("sess-42");
    expect(capture(() => logWarn("hi"))).toBe("BKLOG1\twarn\tsess-42\thi\n");
  });

  test("no session leaves the field empty", () => {
    clearLogSession();
    expect(capture(() => logInfo("hi"))).toBe("BKLOG1\tinfo\t\thi\n");
  });

  test("newlines are flattened to one line", () => {
    const out = capture(() => logError("a\nb\rc"));
    expect(out).toBe("BKLOG1\terror\t\ta b c\n");
    expect(out.split("\n").length).toBe(2);
  });
});

describe("serveAudioConsumerOn", () => {
  const cap: Capability = {
    stage_type: "gate",
    stage_name: "test-consumer",
    lifecycle_modes: ["per_run"],
  } as unknown as Capability;

  async function input(events: PipelineEvent[]): Promise<PassThrough> {
    const s = new PassThrough();
    const w = new PipelineWriter(s);
    for (const ev of events) await w.writeEvent(ev);
    s.end();
    return s;
  }

  const ev = (type: string, data: Record<string, unknown>): PipelineEvent => ({
    type,
    data,
    payload: type === "audio_chunk" ? new Uint8Array([1, 2, 3, 4]) : new Uint8Array(0),
  });

  class Scripted extends BaseConsumer {
    chunks: AudioChunk[] = [];
    stops: string[] = [];
    eofCalls = 0;
    constructor(
      private readonly outcomes: Chunk[],
      private readonly stopFlow: Flow,
    ) {
      super();
    }
    override async onAudioChunk(chunk: AudioChunk, _p: Uint8Array, _c: AudioCtx): Promise<Chunk> {
      const i = this.chunks.length;
      this.chunks.push(chunk);
      return this.outcomes[i] ?? Chunk.Counted;
    }
    override async onAudioStop(stop: AudioStop, _c: AudioCtx): Promise<Flow> {
      this.stops.push(stop.session_id);
      return this.stopFlow;
    }
    override async onEof(_c: AudioCtx): Promise<void> {
      this.eofCalls++;
    }
  }

  test("per-session grant, dropped chunk uncounted, Flow.Stop ends the loop", async () => {
    const inp = await input([
      ev("audio_start", { session_id: "s1", format: { channels: 1, rate: 16000, width: 2 } }),
      ev("audio_chunk", { session_id: "s1", timestamp_ms: 10 }), // counted 1/2
      ev("audio_chunk", { session_id: "s1", timestamp_ms: 20 }), // dropped
      ev("audio_chunk", { session_id: "s1", timestamp_ms: 30 }), // counted 2/2 -> grant 4
      ev("audio_stop", { session_id: "s1" }), // Flow.Stop
      ev("audio_chunk", { session_id: "s1", timestamp_ms: 40 }), // never read
    ]);
    const out = new PassThrough();
    const h = new Scripted([Chunk.Counted, Chunk.Dropped, Chunk.Counted], Flow.Stop);
    await serveAudioConsumerOn(inp, out, cap, { initial: 8, every: 2, grant: 4, when: InitialGrant.OnSessionStart }, h);
    out.end();

    const evs = await drain(out);
    expect(evs[0]!.type).toBe("capability");
    expect((evs[0]!.data as { stage_name: string }).stage_name).toBe("test-consumer");
    expect(credits(evs.slice(1))).toEqual([
      ["s1", 8],
      ["s1", 4],
    ]);
    expect(h.chunks.length).toBe(3);
    expect(h.stops).toEqual(["s1"]);
    expect(h.eofCalls).toBe(0);
  });

  test("OnStart grants before any input; clean EOF reaches onEof", async () => {
    const inp = await input([]);
    const out = new PassThrough();
    const h = new Scripted([], Flow.Continue);
    await serveAudioConsumerOn(inp, out, cap, { initial: 5, every: 0, grant: 0, when: InitialGrant.OnStart }, h);
    out.end();
    const evs = await drain(out);
    expect(evs[0]!.type).toBe("capability");
    expect(credits(evs.slice(1))).toEqual([["", 5]]);
    expect(h.eofCalls).toBe(1);
  });
});
