/**
 * The stage runtime — the layer between wire framing and a working stage.
 *
 * {@link PipelineReader}/{@link PipelineWriter} get bytes on and off the pipe.
 * This owns the obligations above them that every stage otherwise hand-rolls,
 * and that fail SILENTLY when hand-rolled wrong:
 *
 * - the capability handshake goes out first and unprompted,
 * - receiver-side flow credit follows a declared policy rather than a counter
 *   each stage maintains itself,
 * - unknown events are tolerated (wire leniency is contract, not courtesy),
 * - a fatal error becomes one BKLOG1 line and exit 1, the same way in every
 *   stage.
 *
 * ## Which entry point
 *
 * Two, because there are two loop shapes:
 *
 * - {@link serveAudioConsumer} — read-driven. The stage's work is a reaction
 *   to an inbound audio session. VAD gates, STT engines, command recognizers.
 * - {@link serveSource} — notifier-driven. The stage produces spontaneously
 *   from a device, OS notification, or timer, and may never read stdin at all.
 *
 * An audio source is the second shape plus {@link SourceOptions.listenForStop}.
 *
 * ## Why one is media-neutral and the other is not
 *
 * `serveSource` assumes nothing about what you emit. `serveAudioConsumer` is
 * audio-bound because audio is the only STREAM the wire has — `audio_start` /
 * `audio_chunk` / `audio_stop` are the streaming events, everything else is
 * discrete, and flow credit counts audio frames. A runtime cannot be more
 * general than the protocol it speaks.
 *
 * ## Flow credit: which side are you on
 *
 * - Consuming audio → you must grant credit. {@link CreditPolicy} drives it.
 * - Producing audio → you must not implement credit at all. The platform holds
 *   the sender-side window; a producer that outruns it blocks on the pipe.
 *   There is deliberately no sender-side helper here.
 */

import type { Readable, Writable } from "node:stream";
import { PipelineReader, PipelineWriter } from "./pipeline.js";
import type { PipelineEvent } from "./pipeline.js";
import { EventCapability, EventFlowCredit } from "./pipeline_events_gen.js";
import type { Capability } from "./pipeline_events_gen.js";
// The runtime names the audio session types in two places: the AudioConsumer
// interface, and the stop request a listenForStop source reads. Both are audio
// assumptions in an otherwise domain-free runtime — visible here on purpose.
import {
  EventAudioChunk,
  EventAudioStart,
  EventAudioStop,
} from "./pipeline_events_audio_gen.js";
import type { AudioChunk, AudioStart, AudioStop } from "./pipeline_events_audio_gen.js";

// A stage speaks this vocabulary and nothing else, so re-export it here: one
// subpath import gets the runtime and the types together. It is deliberately
// NOT merged into the package root — the plugin-side platform vocabulary has
// its own `DisplayInfo` and `EventDisplayChanged`, and flattening the two
// namespaces would collide. They are different contracts that happen to
// describe some of the same hardware.
export * from "./pipeline_events_gen.js";
export * from "./pipeline_events_audio_gen.js";
export { PipelineReader, PipelineWriter, type PipelineEvent } from "./pipeline.js";

// Recognition and monitor vocabularies are deliberately NOT re-exported here.
// A stage author writing a foot pedal or a frame source should not be handed a
// command-grammar DAG and left to work out that it is irrelevant. Import
// `@branchkitdev/plugin-sdk-ts/stage/recognition` or `/stage/monitors` if you are
// actually building one of those.

// ---------------------------------------------------------------- stage log

/**
 * The sentinel every structured stage diagnostic begins with. The platform's
 * stage stderr reader splits on it to parse
 * `BKLOG1<TAB><level><TAB><session_id><TAB><message>` into correlated
 * per-stage, per-session log records. Lines without it still reach the bus via
 * a generic fallback — just uncorrelated and at info.
 */
export const LOG_LINE_PREFIX = "BKLOG1\t";

let currentSession = "";

/**
 * Set the ambient session id (call it on `audio_start`). Subsequent log lines
 * carry it, so a diagnostic correlates to the command that caused it without
 * threading the id through every call site.
 */
export function setLogSession(sessionId: string): void {
  currentSession = sessionId;
}

/** Clear the ambient session id (call it at session end). */
export function clearLogSession(): void {
  currentSession = "";
}

/** Emit one structured diagnostic on stderr. Embedded newlines are flattened. */
export function stageLog(level: string, message: string): void {
  const flat = message.replace(/[\n\r]+/g, " ");
  process.stderr.write(`${LOG_LINE_PREFIX}${level}\t${currentSession}\t${flat}\n`);
}

export const logTrace = (m: string) => stageLog("trace", m);
export const logDebug = (m: string) => stageLog("debug", m);
export const logInfo = (m: string) => stageLog("info", m);
export const logWarn = (m: string) => stageLog("warn", m);
export const logError = (m: string) => stageLog("error", m);

// ------------------------------------------------------------------- credit

/**
 * Receiver-side flow-credit granting: the chunks-since-last-grant counter and
 * the `flow_credit` emission. HOW MUCH to advertise is receiver-chosen
 * buffering policy and deliberately not part of the contract.
 */
export class CreditGranter {
  private since = 0;

  constructor(
    private readonly every: number,
    private readonly grant: number,
  ) {}

  /**
   * Emit `frames` of credit unconditionally and reset the cadence counter —
   * the initial window, or a re-grant at an utterance boundary.
   */
  async grantNow(w: PipelineWriter, sessionId: string, frames: number): Promise<void> {
    this.since = 0;
    await emitCredit(w, sessionId, frames);
  }

  /**
   * Count one processed chunk, granting after every `every` of them.
   *
   * The counter deliberately survives session boundaries: a stage wanting a
   * per-session reset gets it from `grantNow`'s initial grant, and one that
   * does not simply never resets.
   */
  async onChunk(w: PipelineWriter, sessionId: string): Promise<void> {
    if (this.every === 0) return;
    this.since += 1;
    if (this.since >= this.every) {
      this.since = 0;
      await emitCredit(w, sessionId, this.grant);
    }
  }
}

function emitCredit(w: PipelineWriter, sessionId: string, frames: number): Promise<void> {
  return w.writeEvent({
    type: EventFlowCredit,
    data: { session_id: sessionId, frames } as unknown as Record<string, unknown>,
    payload: new Uint8Array(0),
  });
}

// ------------------------------------------------------------------ policy

/**
 * When the runtime emits the initial credit window.
 *
 * The NUMBERS are receiver-chosen policy and stay at your call site; only the
 * mechanism is shared. This captures the one structural difference between
 * stages: whether the window opens before any session exists.
 */
export enum InitialGrant {
  /** Right after the handshake, with an empty session id — the stage buffers freely. */
  OnStart = "on_start",
  /** On every `audio_start`, stamped with that session. Shallow-queue stages. */
  OnSessionStart = "on_session_start",
  /** Nothing automatic — a runtime-dependent window, or a stage that must never grant. */
  Manual = "manual",
}

/** Receiver-side credit configuration. */
export interface CreditPolicy {
  /** Frames in the unconditional initial window. */
  initial: number;
  /** Grant again after every N processed chunks. */
  every: number;
  /** Frames per cadence grant. */
  grant: number;
  /** When the initial window is emitted. */
  when: InitialGrant;
}

/** The policy for a stage that consumes no audio and must never grant. */
export const NO_CREDIT: CreditPolicy = {
  initial: 0,
  every: 0,
  grant: 0,
  when: InitialGrant.Manual,
};

/** Whether a delivered `audio_chunk` counts toward the credit cadence. */
export enum Chunk {
  /** Processed — count it. The normal answer. */
  Counted = "counted",
  /**
   * Discarded without processing (a stale session id, an unsupported format),
   * so it does not count.
   *
   * Note the open question this preserves rather than settles: a dropped chunk
   * still spent a frame of the sender's window, so never counting it shrinks
   * that window for the rest of the run.
   */
  Dropped = "dropped",
}

/** Whether the consumer loop continues after a callback. */
export enum Flow {
  /** Keep reading. The default. */
  Continue = "continue",
  /** End the loop and return — a `per_run` stage finishing its session. */
  Stop = "stop",
}

// -------------------------------------------------------------------- main

/**
 * Run a stage body as the process entry point, mapping a fatal error to one
 * structured log line and exit code 1.
 */
export async function run(body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (e) {
    logError(`fatal: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- consumer

/** What a consumer callback is handed: the writer, plus the credit granter. */
export class AudioCtx {
  constructor(
    private readonly w: PipelineWriter,
    private readonly credit: CreditGranter,
  ) {}

  /** Write one framed event. */
  emit(eventType: string, data: unknown): Promise<void> {
    return this.w.writeEvent({
      type: eventType,
      data: data as Record<string, unknown>,
      payload: new Uint8Array(0),
    });
  }

  /** Write one framed event with a binary payload. */
  emitRaw(eventType: string, data: unknown, payload: Uint8Array): Promise<void> {
    return this.w.writeEvent({
      type: eventType,
      data: data as Record<string, unknown>,
      payload,
    });
  }

  /**
   * Emit credit unconditionally and reset the cadence counter, for windows the
   * policy cannot express — a re-grant at an utterance boundary.
   */
  grantNow(sessionId: string, frames: number): Promise<void> {
    return this.credit.grantNow(this.w, sessionId, frames);
  }

  /** @internal — the runtime's own cadence call. */
  countChunk(sessionId: string): Promise<void> {
    return this.credit.onChunk(this.w, sessionId);
  }
}

/**
 * A read-driven stage.
 *
 * Extend {@link BaseConsumer} and override only the events you care about; it
 * supplies conformant defaults for the rest. Optional interface methods were
 * the other option and were rejected for the same reason as on the Go side: a
 * misspelled name would silently never be called, which is precisely the
 * failure mode this runtime exists to remove.
 */
export abstract class BaseConsumer {
  /** A session began upstream. */
  async onAudioStart(_ev: AudioStart, _ctx: AudioCtx): Promise<void> {}

  /** One frame of audio. Return `Chunk.Dropped` to keep it out of the cadence. */
  async onAudioChunk(_ev: AudioChunk, _payload: Uint8Array, _ctx: AudioCtx): Promise<Chunk> {
    return Chunk.Counted;
  }

  /** The session ended. A `per_run` stage emits its result here and stops. */
  async onAudioStop(_ev: AudioStop, _ctx: AudioCtx): Promise<Flow> {
    return Flow.Continue;
  }

  /**
   * Any event the runtime did not decode, including unknown types. Ignoring
   * them is the default because wire leniency is contract.
   */
  async onOther(_ev: PipelineEvent, _ctx: AudioCtx): Promise<Flow> {
    return Flow.Continue;
  }

  /** Clean EOF — upstream closed. */
  async onEof(_ctx: AudioCtx): Promise<void> {}
}

/** Serve a read-driven stage on stdin/stdout. */
export function serveAudioConsumer(
  capability: Capability,
  policy: CreditPolicy,
  handler: BaseConsumer,
): Promise<void> {
  return serveAudioConsumerOn(process.stdin, process.stdout, capability, policy, handler);
}

/**
 * {@link serveAudioConsumer} over explicit streams. The stdio wrapper is what
 * stages use; this exists so the runtime itself is testable over a pipe.
 */
export async function serveAudioConsumerOn(
  input: Readable,
  output: Writable,
  capability: Capability,
  policy: CreditPolicy,
  handler: BaseConsumer,
): Promise<void> {
  const reader = new PipelineReader(input);
  const writer = new PipelineWriter(output);
  const ctx = new AudioCtx(writer, new CreditGranter(policy.every || 1, policy.grant));

  await ctx.emit(EventCapability, capability);
  if (policy.when === InitialGrant.OnStart && policy.initial > 0) {
    await ctx.grantNow("", policy.initial);
  }

  for (;;) {
    const ev = await reader.readEvent();
    if (ev === null) {
      await handler.onEof(ctx);
      return;
    }

    switch (ev.type) {
      case EventAudioStart: {
        const start = ev.data as unknown as AudioStart;
        if (policy.when === InitialGrant.OnSessionStart && policy.initial > 0) {
          await ctx.grantNow(start.session_id, policy.initial);
        }
        await handler.onAudioStart(start, ctx);
        break;
      }
      case EventAudioChunk: {
        const chunk = ev.data as unknown as AudioChunk;
        const outcome = await handler.onAudioChunk(chunk, ev.payload, ctx);
        if (outcome === Chunk.Counted && policy.every > 0) {
          await ctx.countChunk(chunk.session_id);
        }
        break;
      }
      case EventAudioStop: {
        const stop = ev.data as unknown as AudioStop;
        if ((await handler.onAudioStop(stop, ctx)) === Flow.Stop) return;
        break;
      }
      default: {
        if ((await handler.onOther(ev, ctx)) === Flow.Stop) return;
        break;
      }
    }
  }
}

// ------------------------------------------------------------------ source

/** Options for {@link serveSource}. */
export interface SourceOptions {
  /**
   * Watch stdin for the platform's `audio_stop` stop request and stop when it
   * arrives (or on EOF, which means the platform is gone).
   *
   * This is what makes an audio source out of an event source: the runner ends
   * a session by writing `audio_stop` to the source's stdin, and that stop may
   * carry a `cutoff_ms` the source must forward verbatim on its own downstream
   * `audio_stop`. Read it back with {@link SourceCtx.stopRequest}.
   *
   * Off by default: an event source that never opens stdin is the common case.
   */
  listenForStop?: boolean;
}

/** A running source stage's handle: the writer plus the stop signal. */
export class SourceCtx {
  private readonly controller = new AbortController();
  private request: AudioStop | null = null;

  constructor(private readonly w: PipelineWriter) {}

  /** Write one framed event. */
  emit(eventType: string, data: unknown): Promise<void> {
    return this.w.writeEvent({
      type: eventType,
      data: data as Record<string, unknown>,
      payload: new Uint8Array(0),
    });
  }

  /** Write one framed event with a binary payload. */
  emitRaw(eventType: string, data: unknown, payload: Uint8Array): Promise<void> {
    return this.w.writeEvent({
      type: eventType,
      data: data as Record<string, unknown>,
      payload,
    });
  }

  /**
   * The stop signal, as the platform-native primitive — pass it to `fetch`,
   * a timer wrapper, or anything else that takes one.
   */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Has a stop been requested? */
  get stopped(): boolean {
    return this.controller.signal.aborted;
  }

  /** Resolves when a stop is requested. Correct as a body's only await. */
  stoppedSignal(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.controller.signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  /** Request a stop from inside the stage. */
  requestStop(): void {
    this.controller.abort();
  }

  /**
   * The `audio_stop` that requested this stop, when the platform sent one and
   * {@link SourceOptions.listenForStop} is on. `null` if the stop came from a
   * signal, from stdin EOF, or from {@link SourceCtx.requestStop}.
   *
   * An audio source forwards this event's `cutoff_ms` verbatim on its own
   * downstream `audio_stop`.
   */
  get stopRequest(): AudioStop | null {
    return this.request;
  }

  /** @internal */
  setStopRequest(stop: AudioStop): void {
    this.request = stop;
  }
}

/**
 * Serve a notifier-driven stage on stdout.
 *
 * Emits the capability handshake, installs a SIGTERM/SIGINT stop watcher (and
 * the stop listener, per `opts`), then hands control to `body`. The stage owns
 * its own loop — that is the point of this shape.
 */
export function serveSource(
  capability: Capability,
  opts: SourceOptions,
  body: (ctx: SourceCtx) => Promise<void>,
): Promise<void> {
  return serveSourceOn(process.stdin, process.stdout, capability, opts, body);
}

/** {@link serveSource} over explicit streams, for tests. */
export async function serveSourceOn(
  input: Readable,
  output: Writable,
  capability: Capability,
  opts: SourceOptions,
  body: (ctx: SourceCtx) => Promise<void>,
): Promise<void> {
  const ctx = new SourceCtx(new PipelineWriter(output));

  const onSignal = () => ctx.requestStop();
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  await ctx.emit(EventCapability, capability);

  if (opts.listenForStop) {
    void watchForStop(input, ctx);
  }

  try {
    await body(ctx);
  } finally {
    process.removeListener("SIGTERM", onSignal);
    process.removeListener("SIGINT", onSignal);
  }
}

/**
 * Read stdin until the platform's `audio_stop` arrives, or until EOF/error —
 * which mean the platform is gone.
 *
 * Every other inbound event is ignored rather than fatal: a source stage must
 * tolerate inbound bytes without dying, which the conformance source suite
 * tests directly.
 */
async function watchForStop(input: Readable, ctx: SourceCtx): Promise<void> {
  const reader = new PipelineReader(input);
  try {
    for (;;) {
      const ev = await reader.readEvent();
      if (ev === null) break;
      if (ev.type !== EventAudioStop) continue;
      ctx.setStopRequest(ev.data as unknown as AudioStop);
      break;
    }
  } catch {
    // EOF or malformed input: the platform is gone or misbehaving; either way
    // this stage should stop rather than die.
  }
  ctx.requestStop();
}
