import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ListenLocal, type ConnectInfo } from "../listen.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures_listen__");

function setup() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
}

function teardown() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
}

describe("ListenLocal", () => {
  test("binds a port and creates connect.json", async () => {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    try {
      const mockPlugin = {} as any;
      const listener = await ListenLocal(mockPlugin);

      // Port should be assigned
      expect(listener.addr()).toMatch(/^127\.0\.0\.1:\d+$/);

      // Token should be 64 hex chars
      expect(listener.getToken()).toMatch(/^[0-9a-f]{64}$/);

      // connect.json should exist
      const connectPath = join(FIXTURE_DIR, "connect.json");
      expect(existsSync(connectPath)).toBe(true);
      const info: ConnectInfo = JSON.parse(readFileSync(connectPath, "utf-8"));
      expect(info.token).toBe(listener.getToken());
      expect(Number(info.port)).toBeGreaterThan(0);

      listener.shutdown();

      // connect.json should be removed after shutdown
      expect(existsSync(connectPath)).toBe(false);
    } finally {
      if (orig !== undefined) {
        process.env.BRANCHKIT_PLUGIN_DIR = orig;
      } else {
        delete process.env.BRANCHKIT_PLUGIN_DIR;
      }
      teardown();
    }
  });

  test("rejects requests without Bearer token", async () => {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    try {
      const listener = await ListenLocal({} as any);
      listener.handleFunc("GET", "/test", (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      const resp = await fetch(`http://${listener.addr()}/test`);
      expect(resp.status).toBe(401);

      listener.shutdown();
    } finally {
      if (orig !== undefined) {
        process.env.BRANCHKIT_PLUGIN_DIR = orig;
      } else {
        delete process.env.BRANCHKIT_PLUGIN_DIR;
      }
      teardown();
    }
  });

  test("rejects requests with wrong token", async () => {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    try {
      const listener = await ListenLocal({} as any);
      listener.handleFunc("GET", "/test", (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });

      const resp = await fetch(`http://${listener.addr()}/test`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(resp.status).toBe(403);

      listener.shutdown();
    } finally {
      if (orig !== undefined) {
        process.env.BRANCHKIT_PLUGIN_DIR = orig;
      } else {
        delete process.env.BRANCHKIT_PLUGIN_DIR;
      }
      teardown();
    }
  });

  test("routes requests with valid token to handler", async () => {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    try {
      const listener = await ListenLocal({} as any);
      listener.handleFunc("GET", "/hello", (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("world");
      });
      listener.serve();

      const resp = await fetch(`http://${listener.addr()}/hello`, {
        headers: { Authorization: `Bearer ${listener.getToken()}` },
      });
      expect(resp.status).toBe(200);
      expect(await resp.text()).toBe("world");

      listener.shutdown();
    } finally {
      if (orig !== undefined) {
        process.env.BRANCHKIT_PLUGIN_DIR = orig;
      } else {
        delete process.env.BRANCHKIT_PLUGIN_DIR;
      }
      teardown();
    }
  });

  test("returns 404 for unregistered routes", async () => {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    try {
      const listener = await ListenLocal({} as any);
      listener.serve();

      const resp = await fetch(`http://${listener.addr()}/missing`, {
        headers: { Authorization: `Bearer ${listener.getToken()}` },
      });
      expect(resp.status).toBe(404);

      listener.shutdown();
    } finally {
      if (orig !== undefined) {
        process.env.BRANCHKIT_PLUGIN_DIR = orig;
      } else {
        delete process.env.BRANCHKIT_PLUGIN_DIR;
      }
      teardown();
    }
  });
});

describe("ListenLocal under Bun with a granted listener", () => {
  test("refuses loudly instead of silently self-binding", async () => {
    // This suite runs under bun:test, so process.versions.bun is set —
    // exactly the runtime that cannot serve an inherited fd. The contract
    // is refuse-loudly (a silent self-bind inside the sandbox serves a
    // dead private loopback).
    const saved = process.env.LISTEN_FDS;
    process.env.LISTEN_FDS = "1";
    try {
      expect(ListenLocal({} as any)).rejects.toThrow(
        /cannot serve an inherited listener fd/,
      );
    } finally {
      if (saved === undefined) delete process.env.LISTEN_FDS;
      else process.env.LISTEN_FDS = saved;
    }
  });
});

describe("Listener dispatch parity with the Go SDK", () => {
  async function withListener(fn: (l: Awaited<ReturnType<typeof ListenLocal>>) => Promise<void>) {
    setup();
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    process.env.BRANCHKIT_PLUGIN_DIR = FIXTURE_DIR;
    const listener = await ListenLocal({} as any);
    try {
      await fn(listener);
    } finally {
      listener.shutdown();
      if (orig !== undefined) process.env.BRANCHKIT_PLUGIN_DIR = orig;
      else delete process.env.BRANCHKIT_PLUGIN_DIR;
      teardown();
    }
  }

  // Routing keyed on req.url (which carries "?x=1") missed a route registered
  // as the bare path. Go's ServeMux matches on path, so the same external
  // service worked against a Go plugin and 404'd against the TS one.
  test("query string does not defeat route matching", async () => {
    await withListener(async (listener) => {
      listener.handleFunc("POST", "/push", (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      listener.serve();

      const auth = { Authorization: `Bearer ${listener.getToken()}` };
      const bare = await fetch(`http://${listener.addr()}/push`, { method: "POST", headers: auth });
      expect(bare.status).toBe(200);

      const queried = await fetch(`http://${listener.addr()}/push?since=12&x=1`, {
        method: "POST",
        headers: auth,
      });
      expect(queried.status).toBe(200);
      expect(await queried.text()).toBe("ok");
    });
  });

  // Node cannot separate bind from accept, so the socket is live before
  // serve(). Answering 503 (not 404) keeps "not ready yet" distinguishable
  // from "wrong path".
  test("requests before serve() get 503, not a misleading 404", async () => {
    await withListener(async (listener) => {
      listener.handleFunc("GET", "/hello", (_req, res) => {
        res.writeHead(200);
        res.end("world");
      });

      const auth = { Authorization: `Bearer ${listener.getToken()}` };
      const early = await fetch(`http://${listener.addr()}/hello`, { headers: auth });
      expect(early.status).toBe(503);

      listener.serve();
      const after = await fetch(`http://${listener.addr()}/hello`, { headers: auth });
      expect(after.status).toBe(200);
    });
  });

  // Auth still precedes readiness — an unauthenticated caller must not be able
  // to probe whether the listener has started serving.
  test("token check runs before the serving gate", async () => {
    await withListener(async (listener) => {
      const resp = await fetch(`http://${listener.addr()}/hello`, {
        headers: { Authorization: "Bearer wrong" },
      });
      expect(resp.status).toBe(403);
    });
  });
});

describe("ListenLocal discovery-file failure", () => {
  // writeDiscovery runs inside the async `listening` callback, outside the
  // promise executor's synchronous frame — so a throw there used to surface as
  // an uncaughtException while the caller awaited a promise that never settled.
  // It must reject instead: without connect.json the external service cannot
  // find the port or token, so the listener is unreachable.
  test("rejects rather than hanging when connect.json cannot be written", async () => {
    const orig = process.env.BRANCHKIT_PLUGIN_DIR;
    // A path whose parent is a FILE, not a directory — writeFileSync throws ENOTDIR.
    setup();
    const blocker = join(FIXTURE_DIR, "blocker");
    writeFileSync(blocker, "not a directory");
    process.env.BRANCHKIT_PLUGIN_DIR = join(blocker, "nested");
    try {
      await expect(
        Promise.race([
          ListenLocal({} as any),
          new Promise((_, rej) => setTimeout(() => rej(new Error("HUNG: promise never settled")), 2000)),
        ]),
      ).rejects.toThrow(/connect\.json/);
    } finally {
      if (orig !== undefined) process.env.BRANCHKIT_PLUGIN_DIR = orig;
      else delete process.env.BRANCHKIT_PLUGIN_DIR;
      teardown();
    }
  });
});

describe("inheritedListenerCount", () => {
  test("reports 0 for absent/invalid LISTEN_FDS and the granted count otherwise", async () => {
    const { inheritedListenerCount } = await import("../listen.js");
    const saved = process.env.LISTEN_FDS;
    try {
      for (const v of ["", "0", "garbage", "-2"]) {
        process.env.LISTEN_FDS = v;
        expect(inheritedListenerCount()).toBe(0);
      }
      delete process.env.LISTEN_FDS;
      expect(inheritedListenerCount()).toBe(0);
      process.env.LISTEN_FDS = "2";
      expect(inheritedListenerCount()).toBe(2);
    } finally {
      if (saved === undefined) delete process.env.LISTEN_FDS;
      else process.env.LISTEN_FDS = saved;
    }
  });
});
