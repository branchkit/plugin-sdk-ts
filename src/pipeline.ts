import type { Readable, Writable } from "node:stream";

/**
 * One wire-format pipeline event: a typed event tag, an opaque JSON data
 * blob, and an optional binary payload.
 */
export interface PipelineEvent {
  type: string;
  data?: Record<string, unknown>;
  payload: Uint8Array;
}

/**
 * Wire header shape — matches the Rust actuator's WireHeader.
 * `data` is omitted when empty/null. `payload_length` is omitted when zero.
 */
interface WireHeader {
  type: string;
  data?: Record<string, unknown>;
  payload_length?: number;
}

/** Maximum payload size (16 MB). */
const MAX_PAYLOAD = 16 * 1024 * 1024;

const EMPTY_PAYLOAD = new Uint8Array(0);

/**
 * Reads framed pipeline events from a Node.js readable stream.
 * Single-owner — do not share across concurrent consumers.
 */
export class PipelineReader {
  private buf = Buffer.alloc(0);
  private stream: Readable;
  private ended = false;
  private waitResolve: (() => void) | null = null;

  constructor(stream: Readable) {
    this.stream = stream;
    stream.on("end", () => {
      this.ended = true;
      this.waitResolve?.();
    });
    stream.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.waitResolve?.();
    });
    // Pause by default — we pull manually via waitForData.
    stream.pause();
  }

  /**
   * Read the next event, or null on clean EOF.
   */
  async readEvent(): Promise<PipelineEvent | null> {
    // Read header line (terminated by \n).
    let line: string | null = null;
    while (line === null) {
      const idx = this.buf.indexOf(0x0a); // '\n'
      if (idx >= 0) {
        line = this.buf.subarray(0, idx).toString("utf-8");
        this.buf = this.buf.subarray(idx + 1);
        break;
      }
      if (this.ended) return null;
      await this.waitForData();
      if (this.ended && this.buf.indexOf(0x0a) < 0) return null;
    }

    let header: WireHeader;
    try {
      header = JSON.parse(line);
    } catch (e) {
      throw new Error(`wire: bad header ${JSON.stringify(line)}: ${e}`);
    }

    const payloadLen = header.payload_length ?? 0;
    if (payloadLen > MAX_PAYLOAD) {
      throw new Error(
        `wire: payload_length ${payloadLen} exceeds 16 MB cap`,
      );
    }

    let payload: Uint8Array = EMPTY_PAYLOAD;
    if (payloadLen > 0) {
      while (this.buf.length < payloadLen) {
        if (this.ended) {
          throw new Error("wire: unexpected EOF reading payload");
        }
        await this.waitForData();
      }
      payload = new Uint8Array(this.buf.subarray(0, payloadLen));
      this.buf = this.buf.subarray(payloadLen);
    }

    const data =
      header.data !== undefined && header.data !== null && Object.keys(header.data).length > 0
        ? header.data
        : undefined;

    return { type: header.type, data, payload };
  }

  private waitForData(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waitResolve = () => {
        this.waitResolve = null;
        resolve();
      };
      this.stream.resume();
    });
  }
}

/**
 * Writes framed pipeline events to a Node.js writable stream.
 * Single-owner — do not share across concurrent producers.
 */
export class PipelineWriter {
  private stream: Writable;

  constructor(stream: Writable) {
    this.stream = stream;
  }

  /**
   * Write an event and flush. Returns when the data has been accepted
   * by the underlying stream.
   */
  async writeEvent(ev: PipelineEvent): Promise<void> {
    const header: WireHeader = { type: ev.type };

    if (ev.data !== undefined && ev.data !== null && Object.keys(ev.data).length > 0) {
      header.data = ev.data;
    }

    if (ev.payload.length > 0) {
      header.payload_length = ev.payload.length;
    }

    const headerLine = JSON.stringify(header) + "\n";
    await this.write(Buffer.from(headerLine, "utf-8"));

    if (ev.payload.length > 0) {
      await this.write(ev.payload);
    }
  }

  private write(data: Uint8Array | Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ok = this.stream.write(data, (err) => {
        if (err) reject(err);
      });
      if (ok) {
        resolve();
      } else {
        this.stream.once("drain", resolve);
      }
    });
  }
}
