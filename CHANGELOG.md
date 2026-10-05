# Changelog

Versions before this file predate it; their contents are in the repo's
git history.

## Unreleased

### Speech engines (stage runtime)

- Added `serveSpeechEngine` / `serveSpeechEngineOn` with the `SpeechEngine`
  interface and `SpeakCtx` (`./stage`): the third stage shape, a
  text-to-speech engine. Each `speak` request becomes an audio session the
  stage streams back (`start`, then `audio` per piece); the runtime keeps
  requests in order, cancels the one in progress the moment the platform
  sends its `audio_stop` (`cancelled`, `signal`), closes a queued one that is
  cancelled before it starts, and ends every utterance with exactly one
  `audio_stop`, after an `error` when `speak` rejects.
- A speech engine's chunk `timestamp_ms` is wall time here: JavaScript
  runtimes expose no absolute reading of the clock the platform stamps
  microphone audio with. The platform times what was heard from the audio
  sink's reports, so nothing depends on it.
- Generated: `Speak`, `PlaybackStarted`, `PlaybackEnded` and their event
  tags; `Capability.voices` with `VoiceInfo`.

### Device triggers

- Added `bindingsSetTriggers` (`TriggerDecl`, `TriggerKind`): a device plugin publishes
  the triggers it offers, each with a label, an optional heading (a layer)
  and whether it is a button or momentary. Settings lists them, bound or not,
  and binds any of them from a command picker as the user's own binding.
  Publish again when a device connects or goes away; the list is dropped when
  the plugin stops.
- Added `bindingsReport` and `bindingsSet` (`BindingsReportRequest`, `BindingsSetRequest`, `BindingEdit`, `BindingEdge`):
  a plugin that owns an input device makes its controls binding triggers,
  bound in the platform's table like hotkeys. It reports each press of one of
  its own triggers and the platform runs what it is bound to; it may set what
  its own triggers are bound to, and those edits run on its authority. The
  caller is always the source: neither call can name another plugin's
  triggers. Trigger names are the plugin's own (`"g2/button3"`), with the
  hotkey event words after them, plus the new `repeat`.

### Key bindings (breaking)

- Removed `keybindsRegister` and its `KeybindsRegisterRequest` / `KeybindsRegisterResult` /
  `RegistrySnapshot` / `RegistryEntry` types. The `keybinds.register` operation is gone: it let any plugin
  replace every hotkey on the machine. The platform now builds the hotkey
  table itself from the `_platform.bindings` collection and the user's edits
  in `_platform.binding_overrides`, and publishes the result as
  `_platform.bindings.active`. A plugin contributes a hotkey under
  `collection_data["_platform.bindings"]` (previously
  `collection_data.keybinds`, same shape).

### Pipeline

- `PipelineReader.readEvent` now rejects a stream that ends in the middle of
  a header (bytes but no trailing newline) with "wire: incomplete header (no
  trailing newline)" instead of returning `null`. `null` still means end of
  stream on a frame boundary. Truncation no longer reads as an orderly close,
  matching the Go and Python readers.
- `DisplayInfo` gains `is_asleep?: boolean`: the display is connected but in
  display sleep. Absent means awake.

## 0.3.0 — 2026-09-28

### D-Bus calls (Linux)

- `plugin.nativeDbusCall({ service, path, interface, method, args })` calls
  one D-Bus method the plugin declared in `requires.dbus.methods` and the user
  switched on. Linux only; elsewhere the call fails with "D-Bus exists only on
  Linux".

### Breaking: generated methods take one request object

- Every generated method that takes parameters now takes a single object,
  typed as its `<Method>Request` interface:
  `plugin.collectionFetch({ id, name })`, not `plugin.collectionFetch(id, name)`.
  Keys are the wire's snake_case names, the same spelling every response
  type already uses (`{ accepts_input: true }`). Positional order came from
  the schema, which is alphabetical, so it said nothing a caller could
  guess, and 62 methods had two or more parameters of one type that
  type-checked just as well swapped. A new optional field can be added later
  without breaking any caller. Methods with no parameters are unchanged.

### `**` in pattern listeners

- `onPattern` now takes `**`, zero or more whole segments, matching the
  platform's subscription grammar: `ext.acme.**` hears every depth under the
  vendor (the bare `ext.acme` included), and `_platform.**` every platform
  event. `*` is unchanged — exactly one segment. Wildcards are whole segments
  only, so `a**` stays literal text. Before this, a `**` pattern matched
  nothing but its own literal text. The matcher runs the platform's topic
  conformance table (a copy ships beside the tests), so it answers exactly
  what delivery does.

### Who sent this event

- `plugin.currentEventOrigin()` (and `getCurrentEventOrigin()`) returns an
  `EventOrigin` (`{source, onBehalfOf}`) for the event notification an `on`
  or `onPattern` listener is handling. The platform delivers every event a
  subscription matches, whoever emitted it, and until now a listener could
  not tell two senders of one event type apart. `source` is the emitter the
  platform authenticated (a plugin id, `_platform`, or a stage's name) and
  can be trusted; `onBehalfOf` is that emitter's own actor label, a claim by
  `source`. Same ambient shape as `currentCorrelation()`; empty in a request
  handler. An actuator that does not send the sender leaves it empty.

## 0.2.0 — 2026-09-19

### The platform's `Action` is a type

`dispatch` — the call a plugin makes most — took raw JSON. It takes the
generated `Action` now, as do `commands.resolve`'s winner and tied
candidates, and the actions a delegated pipeline returns from
`on_transcript`. `Action` is an internally tagged union with a
self-recursive `sequence` variant, and it is rendered in full: no field
that carries an action is raw JSON any more.

Two things stay deliberately open, and say so in their own doc comments:
an action's `params` (per-plugin — `branchkit-gen` types those from the
receiving plugin's `action_types`) and `commands.push`'s `action` (the
authored dialect is a superset of the wire shape, so one type would lie
about it).

### Closed shapes stopped hiding as JSON

Every remaining untyped member of the generated surface was audited
against the code that produces it, and either declared or defended in
writing. Newly typed here:

- `hud.push` takes `HudFragment[]`
- `hud.create_channel` takes the `Anchor` enum (an unrecognised value is
  now an error instead of a silent fall back to the default)
- `selection.set` takes `HUDItem[]`
- `keybinds.register` takes `RegistrySnapshot`
- `commands.enumerate` returns a typed `binding`
- `commands.push` takes `CommandSpec[]`
- `on_commands_changed` carries typed command snapshots — and
  `disabled_plugins`, which the schema had been omitting entirely

Untyped members across the three SDKs: 193 → 147. What is left is listed
field by field, each with a written reason, in the generator's fidelity
ledger (every remaining member is opaque by declaration in the Rust source).

### Known gap

A command `pattern` token is `string | string[]`, an untagged union. The
generator refuses to emit one rather than degrade it to raw JSON, so
`CommandSpec.pattern` and `.variants` stay open and the hand-written
command builder remains the way to construct a pattern.

### Also

First tagged release. `bun add github:branchkit/plugin-sdk-ts#v0.2.0`
pins a fixed tree — until now a git-URL install tracked `main`, so a
plugin's build shifted whenever this repo moved.
