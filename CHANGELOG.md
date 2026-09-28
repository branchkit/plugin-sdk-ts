# Changelog

Versions before this file predate it; their contents are in the repo's
git history.

## Unreleased

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
