import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { adoptSandboxTempDir, suffixUnder, userTempDir } from "../sandbox_tmp.js";

describe("suffixUnder", () => {
  const base = "/private/var/folders/ab/xyz/T";
  test("a dir under the user temp dir is its suffix", () => {
    expect(suffixUnder(base, base + "/branchkit/pedal.foot_pedal/")).toBe("branchkit/pedal.foot_pedal");
    expect(suffixUnder("/var/folders/ab/xyz/T/", "/private/var/folders/ab/xyz/T/branchkit/x/")).toBe("branchkit/x");
  });
  test("anything else changes nothing", () => {
    expect(suffixUnder(base, base + "/")).toBeNull();
    expect(suffixUnder(base, "/private/var/folders/ab/xyz/Tmp/x")).toBeNull();
    expect(suffixUnder(base, "/tmp/x")).toBeNull();
  });
});

// The real call, under Bun on macOS: afterwards the frameworks are told the
// directory named, in the /private spelling a confined process is handed.
test.skipIf(process.platform !== "darwin")("adopting points the frameworks at TMPDIR", () => {
  const base = userTempDir();
  expect(base).not.toBeNull();
  const own = join(base!, "branchkit-sdk-ts-test", String(process.pid));
  mkdirSync(own, { recursive: true });
  try {
    adoptSandboxTempDir("/private" + own);
    expect(realpathSync(userTempDir()!)).toBe(realpathSync(own));
  } finally {
    rmdirSync(own);
  }
});
