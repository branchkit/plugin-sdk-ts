# BranchKit Plugin SDK (TypeScript)

BranchKit is an accessibility plugin platform for the desktop. The platform
loads plugins, confines each one to what it declared, tracks what is true right
now (which app has focus, which mode is active), and routes voice commands,
hotkeys and other input to whichever plugin claims them. This SDK is how a
TypeScript program becomes one of those plugins. MIT licensed.

**Status:** BranchKit is pre-launch; the application is in private
development, and this SDK is published and usable today. Versions are 0.x, so a
minor release can break callers — [CHANGELOG.md](CHANGELOG.md) says what
changed and how to migrate. You can write, build and unit-test a plugin today;
loading it needs a BranchKit install, which is not yet publicly available.

## Install

The SDK installs from GitHub; it is not on npm yet.

```sh
bun add github:branchkit/plugin-sdk-ts
```

It installs under the package name `@branchkitdev/plugin-sdk-ts`, which is
what you import. That tracks the repository's `main`. To pin a release, add
`#<tag>` (for example `#v0.3.0`) or a commit. The changes on `main` since the last tag are
listed under **Unreleased** in the changelog.

The fastest start is the scaffold, which writes a working plugin and builds it:

```sh
branchkit-cli dev init --name my-plugin --template ts
```

A TypeScript plugin ships as one compiled executable, built by
`branchkit-cli dev build`: Bun compiles it, or, for a plugin that accepts local
connections (`requires.sockets.listen`), a Node single executable, because Bun
cannot serve an inherited socket. You write the same code either way.

## A minimal plugin

A plugin is a directory with a manifest, the commands it contributes, and a
program. This is what `dev init` writes, trimmed.

`plugin.json` declares who the plugin is, what it may do, and what it offers:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "min_api_version": "0.2.0",
  "requires": { "privileges": ["input"] },
  "dev": { "build": [["branchkit-cli", "dev", "build"]], "build_dir": "." },
  "run": "./my-plugin-plugin",
  "action_prefix": "myplugin",
  "action_types": {
    "greet": { "label": "Greet", "fields": [{ "key": "name", "label": "Name", "field_type": "string" }] }
  },
  "collection_data": { "voice_commands": "commands.json" },
  "implements": { "on_action": true }
}
```

`commands.json` maps a spoken phrase to an action:

```json
[
  {
    "pattern": ["hello", "branchkit"],
    "action": { "type": "myplugin.greet", "params": { "name": "BranchKit" } },
    "description": "Say Hello BranchKit"
  }
]
```

`src/index.ts` handles the action:

```ts
import { Plugin } from "@branchkitdev/plugin-sdk-ts";

// GreetParams is generated from plugin.json into actions_gen.ts by
// `branchkit-gen --plugin .`.
import type { GreetParams } from "./actions_gen.js";

const plugin = new Plugin();

plugin.handleAction<GreetParams>("myplugin.greet", async (req) => {
  const name = req.params.name ?? "BranchKit";
  await plugin.inputTypeText({ text: `Hello, ${name}!` });
});

await plugin.run(); // resolves when BranchKit stops the plugin
```

Say "hello branchkit" and the plugin types `Hello, BranchKit!` at the cursor.
Typing needs the `input` privilege, which is why the manifest asks for it.

`actions_gen.ts` comes from
[branchkit-gen](https://github.com/branchkit/branchkit-gen)
(`go install github.com/branchkit/branchkit-gen@latest`). It writes a params
interface and a `handle<Action>` registrar for each entry in `action_types`, so
the action string need not be spelled by hand; re-run `branchkit-gen --plugin .`
after editing the manifest.

## Calling the platform

Every platform method has a generated method on `Plugin` that takes one object,
typed as the method's request, and resolves to its typed result:

```ts
const rec = await plugin.collectionFetch({ id, name: "notes" });

await plugin.hudCreateChannel({ channel: "status", accepts_input: true });
```

Arguments are always named, never positional, so each one says what it is and
a wrong name fails the type check. Keys are the platform's snake_case names,
the same spelling every result type uses; leave an optional key out to mean
"absent". The generated methods are in
[src/methods_gen.ts](src/methods_gen.ts) and their request and result types in
[src/types_gen.ts](src/types_gen.ts), with the platform's own description on
every field.

**Errors** from the platform are `RpcCallError` (`code`, `message`, `kind`,
`data`), and `errorKindOf(e)` reads the kind from anything thrown:

```ts
import { errorKindOf } from "@branchkitdev/plugin-sdk-ts";

try {
  await plugin.inputTypeText({ text: "hi" });
} catch (e) {
  if (errorKindOf(e) === "forbidden") { /* declare the privilege */ }
}
```

`UnsupportedError` (a method this OS does not provide) and
`RecordingDisabledError` are subclasses of `RpcCallError` you can test with
`instanceof`. A call that gets no answer in time rejects with
`CallTimeoutError` instead; it is not a refusal, since the platform may have
carried the call out, so re-read before retrying a write.

`plugin.call(method, params)` is the untyped escape hatch, for a method too new
to have a generated wrapper. Prefer the wrapper whenever one exists.

## Permissions and the sandbox

Every plugin runs confined to what its manifest declares, and the platform,
not the SDK, enforces it. A plugin that cannot be sandboxed on the machine
does not start.

- **Privileges.** A call that needs a privilege not listed under
  `requires.privileges` is refused before it runs, with an error of kind
  `forbidden` naming the operation. Some privileges also ask the user the
  first time, and the user can switch any grant off later.
- **Files.** The plugin reads its own directory (`pluginDir()`) and reads and
  writes its own data directory (`pluginDataDir()`). The home directory and
  other plugins' data are out of reach.
- **Network.** None unless `requires.network` asks for it: `"localhost"`, or
  `{"hosts": ["api.example.com"]}`. Connections go through a per-plugin proxy
  that checks each host, and the SDK routes `fetch` and `dial` through it for
  you. A host the manifest does not list, or one the user has switched off, is
  refused with a `HostRefusedError`.

## What the SDK covers

| Need | API |
|---|---|
| Handle an action | generated `handle<Action>` (from `action_types`), `handleAction<T>(action, fn)` |
| Serve your own method | `handle(method, fn)`, `handleCommand(method, fn)` |
| React to events | `on(event, fn)`, `onPattern("ext.acme.**", fn)`, `plugin.currentEventOrigin()`; emit with `eventsEmit` |
| Store state | `get` / `list` / `listPage` / `count` / `put` / `putMany` / `patch` / `delete` / `replace`, `subscribe` |
| Append-only logs | `append`, `appendKeyed`, `listLog`, `getLogEntry`, `deleteLogEntry` |
| Keep a live copy | `mirrorCollection(name)`, `settings<T>(name)` |
| Contribute commands | `command(word("open"), capture("app", "apps")).action(…).build()`, `pushCommandSpecs`, `pushCommandGroup` |
| Bind keys and device buttons | manifest `collection_data["_platform.bindings"]`; a device plugin lists its triggers with `bindingsSetTriggers`, reports presses with `bindingsReport` and proposes settings from its own screen with `bindingsPropose` (guides: *Triggers and authority*, *Make a device a binding source*) |
| A settings tab | `settingsTab(key, fn)` + `implements.settings_tabs` in the manifest; `postButton` / `signalButton` / `confirmButton` |
| Show something | `outputState({ state })` with `sayAction` / `dispatchAction`, `hudPush` |
| Hold a system effect | `assertEffect`, `retractEffect`, `isEffectActive`, `onEffectDisplaced` |
| Trace a request | `plugin.currentCorrelation()` |
| Label calls made for something you host (a script, an extension) | `actingFor(actor, fn)` |
| Find your files | `pluginDir()`, `pluginDataDir()`, `apiVersion()` |
| Log | `info` / `warn` / `error` / `debug` / `trace(tag, data)` to your plugin's log (debug and trace are off by default) |
| Outbound HTTP | `fetch` (routed through the platform's proxy), `UpstreamClient` |
| Raw TCP (MQTT, a local daemon) | `dial(host, port)` |
| Accept local connections | `await ListenLocal(plugin)` with `requires.sockets.listen` |
| Test a plugin | `Harness` from `@branchkitdev/plugin-sdk-ts/harness` |

The `./stage` entry points are for pipeline stages (audio and monitor processes
on a separate wire), not for ordinary plugins.

## Testing a plugin

`Harness` loads your plugin against a simulated platform and matches phrases
the way the real matcher does, without audio:

```ts
import { test, expect } from "bun:test";
import { Harness, harnessBinaryAvailable } from "@branchkitdev/plugin-sdk-ts/harness";

test.skipIf(!harnessBinaryAvailable())("hello branchkit matches", async () => {
  const h = await Harness.start(".");
  try {
    const result = await h.mustSimulateCommand("hello branchkit");
    expect(result.actionType()).toBe("myplugin.greet");
  } finally {
    await h.stop();
  }
});
```

It runs the `branchkit-test-harness` binary, which ships with the BranchKit app
(on macOS, inside `BranchKit.app/Contents/Resources`); set
`BRANCHKIT_TEST_HARNESS` to its path anywhere else. Because the app is not yet
publicly available, the guard above makes harness tests skip outside a
BranchKit install (`Harness.start` throws without the binary); set `BRANCHKIT_REQUIRE_HARNESS=1` (in
CI, say) to make a missing binary a failure instead. `bun test` runs your
tests; `branchkit-cli dev test .` checks the manifest and runs the platform's
own conformance checks against the plugin.

Against a running BranchKit:

```sh
branchkit-cli plugin install . --build            # install it
branchkit-cli dev watch .                          # rebuild and reload on save
branchkit-cli dev say "hello branchkit" --simulate # match and report, execute nothing
branchkit-cli dev plog my-plugin --since 30s       # read its log
```

## Learn more

- **API reference:** the doc comments on every export, starting from
  [src/index.ts](src/index.ts); your editor shows them as you type.
- **Local docs:** `branchkit-cli docs path` prints the documentation bundled
  with your installed BranchKit, for reading or grepping offline.
- **Worked examples:** [helloworld-ts](https://github.com/branchkit/branchkit-plugin-helloworld-ts)
  (exactly what `dev init` writes);
  [snippets](https://github.com/branchkit/branchkit-plugin-snippets), the
  teaching plugin; and real plugins built on the Go SDK with the same surface:
  [keyboard](https://github.com/branchkit/branchkit-plugin-keyboard),
  [system](https://github.com/branchkit/branchkit-plugin-system),
  [placement](https://github.com/branchkit/branchkit-plugin-placement).
- **Tools:** [branchkit-cli](https://github.com/branchkit/branchkit-cli)
  (scaffold, build, install, test, inspect) and
  [branchkit-gen](https://github.com/branchkit/branchkit-gen) (typed action
  params, manifest validation).

## Versioning

Tags follow semver, 0.x for now: a minor release may break callers, and
CHANGELOG.md names every break with its migration. The SDK version is separate
from the platform contract version: the platform refuses to load a plugin whose
manifest `min_api_version` is newer than the contract it speaks, and
`apiVersion()` reports that contract version at run time. The contract itself
changes without deprecation cycles until the first release. The Go
([plugin-sdk-go](https://github.com/branchkit/plugin-sdk-go)), TypeScript and
Python ([plugin-sdk-py](https://github.com/branchkit/plugin-sdk-py)) SDKs
implement the same surface and are held to it by one cross-language conformance
suite.

## Contributing

[Issues](https://github.com/branchkit/plugin-sdk-ts/issues/new/choose) are welcome:
a bug in the SDK or its docs, or, most useful, something you tried to build
and couldn't, with what you needed from the platform. You don't need to know
how BranchKit is built to tell us that.

We don't take pull requests for code yet. Much of each SDK is generated from
BranchKit's platform contracts, which aren't public, and the three are kept in
step across Go, TypeScript and Python, so the maintainers make each change in
all three at once. Files ending in `_gen.ts` are generated; don't edit them by hand.

Found a security problem, such as a way around the sandbox or a permission
check? Please [report it privately](https://github.com/branchkit/plugin-sdk-ts/security/advisories/new),
not in a public issue.

To run this SDK's own tests:

```sh
bun install
npm run -s typecheck && bun test
```

[COMPILE.md](COMPILE.md) explains how plugins are compiled into executables.
