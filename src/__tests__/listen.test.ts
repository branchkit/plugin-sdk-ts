import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, rmSync, readFileSync } from "node:fs";
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
