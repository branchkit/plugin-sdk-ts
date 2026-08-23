# BranchKit Plugin SDK (TypeScript)

The TypeScript SDK for building [BranchKit](https://branchkit.dev)
plugins — processes (run via Bun) that add voice commands, window
management, browser integration, or anything else to the BranchKit
platform. MIT licensed. Feature-parity with the Go SDK, verified by a
shared conformance harness.

## Start here

- **[Your First Plugin](https://branchkit.dev/guide/getting-started/your-first-plugin)** —
  working plugin in ~10 minutes (`branchkit-cli dev init --template ts`)
- **[Plugin Anatomy](https://branchkit.dev/guide/getting-started/plugin-anatomy)** —
  manifest, lifecycle, methods
- **[Plugin API Reference](https://branchkit.dev/reference/specs/plugin-api)** —
  every wire method, generated from the OpenRPC spec

## Minimal plugin

```typescript
import { Plugin } from "@branchkitdev/plugin-sdk-ts";

const plugin = new Plugin();

plugin.handleAction("myplugin.greet", async () => {
  await plugin.call("input.type_text", { text: "Hello!" });
  return { status: "ok" };
});

await plugin.run();
```

Pair with a `plugin.json` manifest declaring the action — see the
tutorial. `branchkit-gen` generates typed param interfaces from your
manifest's `action_types`.

## Key surfaces

| Need | API |
|---|---|
| Handle dispatched actions | `handleAction`, generated `actions_gen.ts` |
| State (collections, 8 verbs) | `get` / `list` / `count` / `put` / `patch` / `delete` / `append` / events |
| Log-shaped collections | `append`, `listLog`, `getLogEntry`, `deleteLogEntry` (sugar over the verbs) |
| Commands & vocabulary | command builder, `commandsPush` |
| Events | manifest `consumes.events` + `plugin.on(event, fn)` |
| Settings UI tab | `settings_tab` manifest field + render method |
| Logging | shared actuator log helpers, `plugin.debug` (per-plugin file) |

## Building

See `COMPILE.md`. Tests run with `bun test`.
