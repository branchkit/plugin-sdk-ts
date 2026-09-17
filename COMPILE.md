# How a TypeScript plugin is built

A TypeScript plugin runs as **one compiled binary in its own directory**. Its
manifest names that binary, and `branchkit-cli dev build` produces it:

```json
{
  "run": "./my-plugin-plugin",
  "dev": { "build": [["branchkit-cli", "dev", "build"]], "build_dir": "." }
}
```

```bash
branchkit-cli dev build     # or: branchkit-cli dev watch
```

`branchkit-cli dev init --template ts` scaffolds exactly this, already built.

## Why compiled, always

BranchKit runs every plugin inside a sandbox that cannot see the user's home
directory. Under it, a shell wrapper cannot be executed, `bun run` exits at
startup because Bun reads its ancestor directories, and Node on a loose bundle
is refused the `lstat` it makes on them. A program in the plugin's own
directory is what the sandbox already allows, and it resolves nothing at
startup.

It also means the people who install your plugin need no JavaScript runtime.
Bun and Node are build tools here. The CLI uses its own pinned,
checksum-verified copies of both, so a build does not depend on what is on
your `PATH`.

## You do not pick the engine

`dev build` reads your manifest:

| Manifest | Engine | Binary |
|---|---|---|
| no `sockets.listen` | Bun (`bun build --compile`) | ~60 MB |
| declares `sockets.listen` | Node single-executable | ~115 MB |

Node is used for listeners for one reason: Bun cannot serve a listening socket
it is handed at startup. It reports that it is listening and silently binds a
different port (oven-sh/bun#22559), and BranchKit hands listener plugins their
socket exactly that way. `ListenLocal` refuses loudly under Bun rather than
serve a dead port. When Bun fixes this, the Node path goes away and nothing in
your plugin changes.

Your code is the same either way, top-level `await` included. For Node, the
CLI bundles your plugin as an ES module and embeds it behind a small CommonJS
loader, because a Node single-executable's entry must be CommonJS.

## If you build by hand

The CLI passes two flags to Bun that are required, not optional:

```bash
bun build src/index.ts --compile \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --outfile my-plugin-plugin
```

Without them, the compiled binary's startup autoload of `.env` and
`bunfig.toml` fails inside the sandbox and takes `process.env` with it: the
plugin starts with **no environment variables at all** and says nothing about
it. It will not know its own id, its plugin directory, or its granted
listeners.

## Releasing for other platforms

Binaries are per OS and architecture, and `branchkit-cli plugin package`
names its artifacts that way. Build each one on its own platform (a CI matrix
is the simple way). Bun can cross-compile with `--target=bun-linux-x64` and
similar; the CLI does not drive that yet.
