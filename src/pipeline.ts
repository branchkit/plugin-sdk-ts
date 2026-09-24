import type { Readable, Writable } from "node:stream";

/**
 * One wire-format pipeline event: a typed event tag, an opaque JSON data
 * blob, and an optional binary payload.
 */
export interface PipelineEvent {
  type: string;
  data?: Record<string, unknown>;
  payload: Uint8Array;
  /**
   * The exact bytes `data` arrived as, when this event came off a
   * {@link PipelineReader}. Go keeps a frame's data as json.RawMessage and
   * re-emits it verbatim; JSON.parse + JSON.stringify is NOT the same bytes
   * (1e16 -> 10000000000000000, 1.10 -> 1.1, "\u00e9" -> raw é, integers past
   * 2^53 lose precision). The writer re-emits these bytes as long as `data`
   * still deep-equals what they decode to, so an untouched pass-through is
   * byte-identical to Go's while an edit to `data` gets serialised.
   */
  rawData?: Uint8Array;
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

const isWs = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

function skipWs(b: Uint8Array, i: number): number {
  while (i < b.length && isWs(b[i])) i++;
  return i;
}

/** Index just past the string whose opening quote is at `i`. */
function skipString(b: Uint8Array, i: number): number {
  i++;
  while (i < b.length) {
    const c = b[i];
    if (c === 0x5c) i += 2; // backslash escape
    else if (c === 0x22) return i + 1;
    else i++;
  }
  throw new Error("unterminated string");
}

/** Index just past the JSON value starting at `i` (already validated). */
function skipValue(b: Uint8Array, i: number): number {
  const c = b[i];
  if (c === 0x22) return skipString(b, i);
  if (c === 0x7b || c === 0x5b) {
    let depth = 0;
    while (i < b.length) {
      const d = b[i];
      if (d === 0x22) {
        i = skipString(b, i);
        continue;
      }
      if (d === 0x7b || d === 0x5b) depth++;
      else if (d === 0x7d || d === 0x5d) {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    throw new Error("unterminated container");
  }
  // Scalar: number / true / false / null — runs to the next delimiter.
  while (i < b.length && !isWs(b[i]) && b[i] !== 0x2c && b[i] !== 0x7d) i++;
  return i;
}

/**
 * The [start, end) byte span of the top-level `data` value in a header line
 * that JSON.parse has already accepted. A duplicate key yields the LAST span,
 * as JSON.parse (and Go) keep the last value. Works on bytes, not the decoded
 * string, so invalid UTF-8 inside `data` survives the echo as Go's does.
 */
function dataSpan(b: Uint8Array): [number, number] | null {
  let span: [number, number] | null = null;
  let i = skipWs(b, 0);
  if (b[i] !== 0x7b) return null;
  i = skipWs(b, i + 1);
  while (i < b.length && b[i] === 0x22) {
    const keyEnd = skipString(b, i);
    const key = JSON.parse(Buffer.from(b.subarray(i, keyEnd)).toString("utf-8"));
    i = skipWs(b, keyEnd);
    i = skipWs(b, i + 1); // past ':'
    const end = skipValue(b, i);
    if (key === "data") span = [i, end];
    i = skipWs(b, end);
    if (b[i] !== 0x2c) break;
    i = skipWs(b, i + 1);
  }
  return span;
}

/**
 * Drop insignificant whitespace outside strings, leaving every other byte
 * alone — what Go's encoder does to a json.RawMessage.
 */
function compact(raw: Uint8Array): Uint8Array {
  if (!raw.some(isWs)) return raw;
  const out: number[] = [];
  let inStr = false;
  let esc = false;
  for (const c of raw) {
    if (inStr) {
      out.push(c);
      if (esc) esc = false;
      else if (c === 0x5c) esc = true;
      else if (c === 0x22) inStr = false;
    } else if (!isWs(c)) {
      out.push(c);
      if (c === 0x22) inStr = true;
    }
  }
  return Uint8Array.from(out);
}

/**
 * Structural equality with strict types (`===` on leaves, arrays are not
 * objects), so a stage that swapped a value's type has changed the wire
 * bytes and the raw slice must not mask that.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, k) => same(x, bb[k]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && same(ao[k], bo[k]));
}

/** The event's original data bytes if `data` still equals them, else null. */
function rawIfUnchanged(ev: PipelineEvent): Uint8Array | null {
  const raw = ev.rawData;
  if (raw === undefined) return null;
  let original: unknown;
  try {
    original = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch {
    return null;
  }
  return same(original, ev.data) ? raw : null;
}

// A lone surrogate cannot be encoded as UTF-8. Well-formed JSON.stringify
// emits it as a "\udXXX" escape, but Go's decoder maps an invalid "\ud800"
// escape to U+FFFD, so a Go stage that decoded and re-encoded the value
// emits U+FFFD — and so does the Python port. Match it.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const ESCAPED_SURROGATE = /\\u[dD][89a-fA-F]/;

function wellFormed(v: unknown): unknown {
  if (typeof v === "string") return v.replace(LONE_SURROGATE, "\uFFFD");
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(wellFormed);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[wellFormed(k) as string] = wellFormed(x);
  return out;
}

/**
 * Compact JSON, UTF-8 emitted raw and <, >, & unescaped — the Rust writer's
 * canonical form, which Go matches via SetEscapeHTML(false).
 */
function encode(v: unknown): Buffer {
  let s = JSON.stringify(v);
  // Cheap prefilter: only a lone surrogate (or a literal backslash-u text,
  // a harmless false positive) can produce this escape.
  if (ESCAPED_SURROGATE.test(s)) s = JSON.stringify(wellFormed(v));
  return Buffer.from(s, "utf-8");
}

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
    let lineBytes: Buffer = Buffer.alloc(0);
    while (line === null) {
      const idx = this.buf.indexOf(0x0a); // '\n'
      if (idx >= 0) {
        lineBytes = this.buf.subarray(0, idx);
        line = lineBytes.toString("utf-8");
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

    const ev: PipelineEvent = { type: header.type, data, payload };
    if (data !== undefined) {
      const span = dataSpan(lineBytes);
      if (span !== null) {
        // Copy: lineBytes views this.buf, which later chunks replace.
        ev.rawData = compact(Uint8Array.from(lineBytes.subarray(span[0], span[1])));
      }
    }
    return ev;
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
    // Field order matches WireHeader: type, data, payload_length.
    const parts: Buffer[] = [Buffer.from('{"type":'), encode(ev.type)];

    if (ev.data !== undefined && ev.data !== null && Object.keys(ev.data).length > 0) {
      parts.push(Buffer.from(',"data":'));
      const raw = rawIfUnchanged(ev);
      parts.push(raw !== null ? Buffer.from(raw) : encode(ev.data));
    }

    if (ev.payload.length > 0) {
      parts.push(Buffer.from(`,"payload_length":${ev.payload.length}`));
    }

    parts.push(Buffer.from("}\n"));
    await this.write(Buffer.concat(parts));

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
