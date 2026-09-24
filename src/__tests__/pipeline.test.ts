import { describe, test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { PipelineReader, PipelineWriter, type PipelineEvent } from "../pipeline.js";

/** Create a linked reader/writer pair over an in-memory stream. */
function pair(): { reader: PipelineReader; writer: PipelineWriter; stream: PassThrough } {
  const stream = new PassThrough();
  return { reader: new PipelineReader(stream), writer: new PipelineWriter(stream), stream };
}

describe("PipelineReader / PipelineWriter", () => {
  test("roundtrip with no payload", async () => {
    const { reader, writer, stream } = pair();

    await writer.writeEvent({
      type: "audio_stop",
      data: { session_id: "abc" },
      payload: new Uint8Array(0),
    });

    const ev = await reader.readEvent();
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("audio_stop");
    expect(ev!.data).toEqual({ session_id: "abc" });
    expect(ev!.payload.length).toBe(0);

    stream.end();
  });

  test("roundtrip with payload", async () => {
    const { reader, writer, stream } = pair();

    const payload = new Uint8Array(640);
    for (let i = 0; i < payload.length; i++) payload[i] = i & 0xff;

    await writer.writeEvent({
      type: "audio_chunk",
      data: { session_id: "abc", timestamp_ms: 120 },
      payload,
    });

    const ev = await reader.readEvent();
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe("audio_chunk");
    expect(ev!.data).toEqual({ session_id: "abc", timestamp_ms: 120 });
    expect(ev!.payload).toEqual(payload);

    stream.end();
  });

  test("multiple events in order", async () => {
    const { reader, writer, stream } = pair();

    for (let i = 0; i < 5; i++) {
      await writer.writeEvent({
        type: "audio_chunk",
        data: { session_id: "s", timestamp_ms: i * 20 },
        payload: new Uint8Array(16).fill(i),
      });
    }

    for (let i = 0; i < 5; i++) {
      const ev = await reader.readEvent();
      expect(ev).not.toBeNull();
      expect(ev!.type).toBe("audio_chunk");
      expect(ev!.payload).toEqual(new Uint8Array(16).fill(i));
    }

    stream.end();
  });

  test("header omits zero payload_length", async () => {
    const stream = new PassThrough();
    const writer = new PipelineWriter(stream);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await writer.writeEvent({
      type: "audio_stop",
      data: { session_id: "x" },
      payload: new Uint8Array(0),
    });

    const raw = Buffer.concat(chunks).toString("utf-8");
    expect(raw).not.toContain("payload_length");

    stream.end();
  });

  test("header omits empty data", async () => {
    const stream = new PassThrough();
    const writer = new PipelineWriter(stream);

    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));

    await writer.writeEvent({
      type: "audio_stop",
      payload: new Uint8Array(0),
    });

    const raw = Buffer.concat(chunks).toString("utf-8");
    expect(raw).not.toContain('"data"');

    stream.end();
  });

  test("returns null on clean EOF", async () => {
    const stream = new PassThrough();
    const reader = new PipelineReader(stream);

    stream.end();

    const ev = await reader.readEvent();
    expect(ev).toBeNull();
  });
});

/** Read every frame in `raw` and re-emit it: what a pass-through stage and
 * the framing conformance fixture both do. */
async function echo(raw: Buffer): Promise<Buffer> {
  const events = await readAll(raw);
  return writeAll(events);
}

async function readAll(raw: Buffer): Promise<PipelineEvent[]> {
  const input = new PassThrough();
  const reader = new PipelineReader(input);
  input.end(raw);
  const events: PipelineEvent[] = [];
  for (let ev = await reader.readEvent(); ev !== null; ev = await reader.readEvent()) {
    events.push(ev);
  }
  return events;
}

async function writeAll(events: PipelineEvent[]): Promise<Buffer> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const writer = new PipelineWriter(out);
  for (const ev of events) await writer.writeEvent(ev);
  return Buffer.concat(chunks);
}

describe("data byte preservation", () => {
  // Go keeps `data` as json.RawMessage, so an echoed frame keeps its exact
  // bytes. JSON.parse + JSON.stringify changed these values.
  const CASES = [
    '{"type":"t","data":{"v":1e-7}}\n',
    '{"type":"t","data":{"v":1e16}}\n', // was 10000000000000000
    '{"type":"t","data":{"v":1.10}}\n', // was 1.1
    '{"type":"t","data":{"s":"\\u00e9"}}\n', // was raw é
    '{"type":"t","data":{"s":"\\ud800"}}\n', // lone surrogate escape
    '{"type":"t","data":{"v":9007199254740993}}\n', // > 2^53, was ...992
    '{"type":"t","data":{"v":[1E+2,-0,0.0,"<&>"]}}\n',
    '{"type":"t","data":{"v":1e-7},"payload_length":2}\nab',
  ];

  for (const raw of CASES) {
    test(`echo is byte-identical: ${JSON.stringify(raw)}`, async () => {
      expect((await echo(Buffer.from(raw))).toString("latin1")).toBe(
        Buffer.from(raw).toString("latin1"),
      );
    });
  }

  test("parsed value still exposed", async () => {
    const [ev] = await readAll(Buffer.from(CASES[0]));
    expect(ev.data).toEqual({ v: 1e-7 });
    expect(Buffer.from(ev.rawData!).toString()).toBe('{"v":1e-7}');
  });

  test("whitespace compacted like Go", async () => {
    const out = await echo(
      Buffer.from('{ "type" : "t" , "data" : { "v" : 1e-7 , "s" : "a b" } }\n'),
    );
    expect(out.toString()).toBe('{"type":"t","data":{"v":1e-7,"s":"a b"}}\n');
  });

  test("edited data is reserialised", async () => {
    const [ev] = await readAll(Buffer.from('{"type":"t","data":{"v":1e-7}}\n'));
    ev.data!.v = 2;
    expect((await writeAll([ev])).toString()).toBe('{"type":"t","data":{"v":2}}\n');
  });

  test("replaced data object is reserialised", async () => {
    const [ev] = await readAll(Buffer.from('{"type":"t","data":{"v":1e16}}\n'));
    const out = await writeAll([{ ...ev, data: { w: 1 } }]);
    expect(out.toString()).toBe('{"type":"t","data":{"w":1}}\n');
  });

  test("type swap is an edit", async () => {
    const [ev] = await readAll(Buffer.from('{"type":"t","data":{"v":1}}\n'));
    ev.data!.v = true;
    expect((await writeAll([ev])).toString()).toBe('{"type":"t","data":{"v":true}}\n');
    const [ev2] = await readAll(Buffer.from('{"type":"t","data":{"v":[1]}}\n'));
    ev2.data!.v = { 0: 1 };
    expect((await writeAll([ev2])).toString()).toBe('{"type":"t","data":{"v":{"0":1}}}\n');
  });

  test("constructed lone surrogate becomes U+FFFD", async () => {
    const out = await writeAll([
      { type: "t", data: { s: "a\ud800b", ["k\udc00"]: 1 }, payload: new Uint8Array(0) },
    ]);
    expect(out.toString()).toBe('{"type":"t","data":{"s":"a\ufffdb","k\ufffd":1}}\n');
  });

  test("literal backslash-u text is not rewritten", async () => {
    const out = await writeAll([{ type: "t", data: { s: "\\ud800" }, payload: new Uint8Array(0) }]);
    expect(out.toString()).toBe('{"type":"t","data":{"s":"\\\\ud800"}}\n');
  });

  test("invalid UTF-8 in data passes through", async () => {
    const raw = Buffer.concat([
      Buffer.from('{"type":"t","data":{"s":"'),
      Buffer.from([0xff]),
      Buffer.from('"}}\n'),
    ]);
    expect((await echo(raw)).equals(raw)).toBe(true);
  });

  test("duplicate data key keeps the last value", async () => {
    const out = await echo(Buffer.from('{"type":"t","data":{"v":1},"data":{"v":1.50}}\n'));
    expect(out.toString()).toBe('{"type":"t","data":{"v":1.50}}\n');
  });

  test("empty data still omitted", async () => {
    expect((await echo(Buffer.from('{"type":"t","data":{ }}\n'))).toString()).toBe(
      '{"type":"t"}\n',
    );
  });

  test("HTML characters are not escaped", async () => {
    const out = await writeAll([{ type: "t", data: { s: "<&>" }, payload: new Uint8Array(0) }]);
    expect(out.toString()).toBe('{"type":"t","data":{"s":"<&>"}}\n');
  });
});
