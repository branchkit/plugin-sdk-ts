/**
 * Point Apple's frameworks at the temporary directory the sandbox grants.
 *
 * BranchKit names each confined process's own temporary directory in
 * `$TMPDIR`, a directory under the user's temporary directory, and refuses
 * the rest of it. Apple's frameworks ignore `$TMPDIR` on macOS: they ask
 * `confstr(_CS_DARWIN_USER_TEMP_DIR)`, which answers the shared directory,
 * and writing there is refused. Some stop the process when that happens:
 * Metal's graph compiler, which Core ML uses on the GPU, fails an assertion.
 *
 * libSystem's `_set_user_dir_suffix` moves that answer onto `$TMPDIR`. It is
 * per-process state, so it happens when the SDK is imported, before a native
 * addon can load a framework. Only under Bun, through `bun:ffi`: Node has no
 * foreign-function interface, so a Node process that loads Apple frameworks
 * through a native addon has to make this call from the addon. Unconfined,
 * `$TMPDIR` is the user's temporary directory itself (or unset), and nothing
 * changes.
 */

/** `<unistd.h>`'s `_CS_DARWIN_USER_TEMP_DIR`. */
const CS_DARWIN_USER_TEMP_DIR = 65537;

/**
 * The suffix that moves `base` (the user's temporary directory) onto `own`
 * (`$TMPDIR`), or `null` when `own` is not strictly under it. Compared as
 * text: the system answers `/var/folders/...` and BranchKit names
 * `/private/var/folders/...` (`/var` is a link to `/private/var`), and a
 * confined process is refused the reads that resolving the link would take.
 */
export function suffixUnder(base: string, own: string): string | null {
  const norm = (p: string) => {
    const t = p.replace(/\/+$/, "");
    return t.startsWith("/private/var/") ? t.slice("/private".length) : t;
  };
  const b = norm(base);
  const o = norm(own);
  if (!o.startsWith(b + "/")) return null;
  const rest = o.slice(b.length + 1);
  return rest === "" ? null : rest;
}

type Libc = {
  confstr: (name: number, buf: unknown, len: number) => number | bigint;
  _set_user_dir_suffix: (suffix: unknown) => boolean;
};

function openLibc(): { libc: Libc; ptr: (b: Uint8Array) => unknown } | null {
  if (process.platform !== "darwin") return null;
  if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") return null;
  const req = (import.meta as unknown as { require?: (m: string) => unknown }).require;
  if (!req) return null;
  const ffi = req("bun:ffi") as {
    dlopen: (path: string, syms: Record<string, unknown>) => { symbols: Libc };
    FFIType: Record<string, unknown>;
    ptr: (b: Uint8Array) => unknown;
  };
  const T = ffi.FFIType;
  const lib = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
    confstr: { args: [T.i32, T.ptr, T.u64], returns: T.u64 },
    _set_user_dir_suffix: { args: [T.ptr], returns: T.bool },
  });
  return { libc: lib.symbols, ptr: ffi.ptr };
}

/** `confstr(_CS_DARWIN_USER_TEMP_DIR)`, or null where it cannot be asked. */
export function userTempDir(): string | null {
  try {
    const o = openLibc();
    if (!o) return null;
    const buf = new Uint8Array(1024);
    const n = Number(o.libc.confstr(CS_DARWIN_USER_TEMP_DIR, o.ptr(buf), buf.length));
    if (n === 0 || n > buf.length) return null;
    return new TextDecoder().decode(buf.subarray(0, n - 1));
  } catch {
    return null;
  }
}

/** Apply `$TMPDIR` (or `own`) to the frameworks. A no-op off macOS, outside
 * Bun, unconfined, or if libSystem lacks the call. */
export function adoptSandboxTempDir(own: string | undefined = process.env.TMPDIR): void {
  if (!own) return;
  try {
    const o = openLibc();
    if (!o) return;
    const base = userTempDir();
    const suffix = base ? suffixUnder(base, own) : null;
    if (suffix === null) return;
    const cstr = new TextEncoder().encode(suffix + "\0");
    if (!o.libc._set_user_dir_suffix(o.ptr(cstr))) {
      console.error("[branchkit-sdk] could not move the temporary directory to $TMPDIR; Apple frameworks may be refused theirs");
    }
  } catch {
    // A missing symbol or an FFI refusal must not take the process down at
    // import time; the frameworks then use the shared directory, as before.
  }
}

adoptSandboxTempDir();
