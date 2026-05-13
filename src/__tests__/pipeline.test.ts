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
