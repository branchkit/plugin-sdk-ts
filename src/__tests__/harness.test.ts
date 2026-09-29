// Integration tests that drive the Rust `branchkit-test-harness` binary
// against the app repo's plugins/helloworld (the Go one). Two things must
// exist first:
//
//   1. the harness binary — `cargo build -p branchkit-test-harness` in the
//      app repo, or BRANCHKIT_TEST_HARNESS=/path/to/branchkit-test-harness;
//   2. the helloworld plugin's binary, which the harness spawns —
//      `cd plugins/helloworld/src && go build -o ../helloworld-plugin .`
//
// Either one missing skips the suite with a message saying which. Set
// BRANCHKIT_REQUIRE_HARNESS=1 (any CI lane that builds them) to make a
// missing piece FAIL instead: a skip reports green, so a lookup that quietly
// stops finding the binary would otherwise go unnoticed.
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import {
  Harness,
  harnessBinaryAvailable,
  harnessRequired,
} from "../harness.js";

const HELLOWORLD_DIR = new URL(
  "../../../plugins/helloworld",
  import.meta.url,
).pathname;
const APPS_PROVIDER_DIR = new URL(
  "./testdata/apps-provider",
  import.meta.url,
).pathname;

const HELLOWORLD_BIN = `${HELLOWORLD_DIR}/helloworld-plugin`;
const helloworldBuilt = existsSync(HELLOWORLD_BIN);
const HELLOWORLD_MISSING =
  `helloworld plugin not built (${HELLOWORLD_BIN}); build it with ` +
  "`cd plugins/helloworld/src && go build -o ../helloworld-plugin .`";

if (!harnessBinaryAvailable()) {
  console.warn(
    "harness.test.ts: skipping — branchkit-test-harness not found. Build it " +
      "with `cargo build -p branchkit-test-harness` or set " +
      "BRANCHKIT_TEST_HARNESS; BRANCHKIT_REQUIRE_HARNESS=1 fails instead.",
  );
} else if (!helloworldBuilt) {
  if (harnessRequired()) {
    throw new Error(`BRANCHKIT_REQUIRE_HARNESS is set: ${HELLOWORLD_MISSING}`);
  }
  console.warn(`harness.test.ts: skipping — ${HELLOWORLD_MISSING}`);
}

describe.skipIf(!harnessBinaryAvailable() || !helloworldBuilt)("Harness", () => {
  test("start and get plugin state", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const state = await h.getPluginState();
      expect(state.alive).toBe(true);
      expect(state.plugin_id).toBe("helloworld");
    } finally {
      await h.stop();
    }
  });

  test("simulate command tie surfaced", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      // Seed the consumed `apps` vocabulary so the capture branch is live —
      // helloworld only consumes it; in production the system plugin
      // provides it (the stub carries the same schema, and the writer must
      // be the introducer because named_entities pins introducer_only).
      // With "branchkit" seeded, "hello branchkit" completes BOTH
      // helloworld commands at the same length (the ["hello","branchkit"]
      // literal and the ["hello","<apps>"] capture). Equally-eligible
      // same-length candidates are a genuine tie: the matcher declines to
      // act and surfaces the tied set for disambiguation rather than
      // guessing.
      await h.loadManifest(APPS_PROVIDER_DIR);
      await h.writeCollection(
        "apps",
        { spoken: "branchkit", bundle_id: "com.test.branchkit" },
        "apps-provider-stub",
      );
      const result = await h.simulateCommand("hello branchkit");
      expect(result.matched).toBe(false);
      expect(result.tied_candidates?.length).toBe(2);
      for (const c of result.tied_candidates ?? []) {
        expect(c.owner_plugin).toBe("helloworld");
      }
    } finally {
      await h.stop();
    }
  });

  test("simulate command no match", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      const result = await h.simulateCommand("this will not match anything");
      expect(result.matched).toBe(false);
    } finally {
      await h.stop();
    }
  });

  test("parameterized command", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      // With the provider stub's schema loaded, the `<apps>` capture
      // resolves the spoken key to the collection's value field, so the
      // action's "{apps}" placeholder carries the bundle id.
      await h.loadManifest(APPS_PROVIDER_DIR);
      await h.writeCollection(
        "apps",
        { spoken: "finder", bundle_id: "com.apple.finder" },
        "apps-provider-stub",
      );
      const result = await h.mustSimulateCommand("hello finder");
      const params = result.actionParams<{ name: string }>();
      expect(params.name).toBe("com.apple.finder");
    } finally {
      await h.stop();
    }
  });

  test("tag set/get/clear", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      await h.setTag("test.example.tag");
      await h.requireTag("test.example.tag");

      const tags = await h.getTags("test.example.*");
      expect(tags).toEqual(["test.example.tag"]);

      await h.clearTag("test.example.tag");
      await h.requireNoTag("test.example.tag");
    } finally {
      await h.stop();
    }
  });

  test("reset clears state", async () => {
    const h = await Harness.start(HELLOWORLD_DIR);
    try {
      await h.setTag("test.before.reset");
      await h.requireTag("test.before.reset");

      await h.reset();

      await h.requireNoTag("test.before.reset");
      const state = await h.getPluginState();
      expect(state.alive).toBe(true);
    } finally {
      await h.stop();
    }
  });
});
