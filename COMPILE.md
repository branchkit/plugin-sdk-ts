# Building Standalone Plugin Binaries

By default, TypeScript plugins run via `bun run ./index.ts` — the actuator downloads the Bun runtime on demand. For distribution to end users who may not have Bun installed, you can compile your plugin into a standalone native binary.

## Quick Start

```bash
bun build --compile ./index.ts --outfile plugin
```

This produces a single `plugin` binary (~50-100MB) that embeds the Bun runtime (JavaScriptCore). Update your `plugin.json` to use it:

```json
{
  "run": "./plugin"
}
```

## Options

### Target platform

Cross-compile for a specific platform:

```bash
# macOS ARM (Apple Silicon)
bun build --compile --target=bun-darwin-arm64 ./index.ts --outfile plugin

# macOS Intel
bun build --compile --target=bun-darwin-x64 ./index.ts --outfile plugin
```

### Minification

Reduce binary size slightly:

```bash
bun build --compile --minify ./index.ts --outfile plugin
```

### Source map

Include source maps for debugging:

```bash
bun build --compile --sourcemap ./index.ts --outfile plugin
```

## Tradeoffs

| Approach | Binary size | Startup | Runtime needed |
|----------|-------------|---------|----------------|
| `bun run ./index.ts` | 0 (source only) | ~50ms | Bun (shared, downloaded once) |
| `bun build --compile` | ~50-100MB | ~10ms | None (self-contained) |

**Use `bun run`** when:
- Developing locally
- Multiple TS plugins share one Bun runtime
- You want smaller plugin downloads

**Use `bun build --compile`** when:
- Distributing to end users
- The plugin must work offline without Bun installed
- You want zero external dependencies

## Plugin Manifest

For compiled plugins, the manifest should reference the binary directly:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "run": "./plugin",
  "action_prefix": "my"
}
```

For source plugins (development or shared-runtime):

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "run": "bun run ./index.ts",
  "action_prefix": "my"
}
```

## CI Build Example

Build for both architectures in GitHub Actions:

```yaml
- uses: oven-sh/setup-bun@v2
- run: |
    bun build --compile --target=bun-darwin-arm64 ./index.ts --outfile plugin-arm64
    bun build --compile --target=bun-darwin-x64 ./index.ts --outfile plugin-x64
    lipo -create plugin-arm64 plugin-x64 -output plugin
```

The `lipo` step creates a universal binary that works on both Apple Silicon and Intel Macs.
