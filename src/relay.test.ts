import { describe, expect, test } from "bun:test";
import { createServer as createTcpServer, type Socket } from "node:net";
import { request } from "node:http";
import { ListenLocal } from "./listen.js";
import { RELAY_HEADER_PREFIX, relayEnv } from "./relay.js";

// A stand-in for the actuator's relay (listener_relay.rs): parks plugin
// connections presenting the right header, and for each client on the public
// port writes OK on one of them and pumps bytes both ways.
function fakeRelay(token: string): Promise<{ rendezvous: string; publicPort: number; stop: () => void }> {
  const parked: Socket[] = [];
  const rv = createTcpServer((plugin) => {
    let head = "";
    const onData = (chunk: Buffer) => {
      head += chunk.toString();
      if (!head.includes("\n")) return;
      plugin.removeListener("data", onData);
      if (head !== `${RELAY_HEADER_PREFIX}trial ${token}\n`) {
        plugin.destroy();
        return;
      }
      parked.push(plugin);
    };
    plugin.on("data", onData);
  });
  const pub = createTcpServer((client) => {
    const plugin = parked.shift();
    if (!plugin) {
      client.destroy();
      return;
    }
    plugin.write("OK\n");
    client.pipe(plugin);
    plugin.pipe(client);
    client.on("close", () => plugin.destroy());
    plugin.on("close", () => client.destroy());
  });
  return new Promise((resolve) => {
    rv.listen(0, "127.0.0.1", () => {
      pub.listen(0, "127.0.0.1", () => {
        const a = rv.address() as { port: number };
        const b = pub.address() as { port: number };
        resolve({
          rendezvous: `127.0.0.1:${a.port}`,
          publicPort: b.port,
          stop: () => {
            rv.close();
            pub.close();
          },
        });
      });
    });
  });
}

function get(port: number, path: string, token?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", headers: token ? { Authorization: `Bearer ${token}` } : {} },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("relay", () => {
  // Under Bun, node:http does not accept sockets fed via emit("connection")
  // the way Node does; the relay path runs under the Node engine (the build
  // picks Node for any plugin declaring sockets.listen), so the wire is
  // verified there. See the fd case in listen.test.ts for the same split.
  const runtimeIsBun = Boolean(process.versions.bun);
  test.skipIf(runtimeIsBun)("ListenLocal serves through the actuator's relay", async () => {
    const token = "0123456789abcdef0123456789abcdef";
    const relay = await fakeRelay(token);
    const saved = { ...process.env };
    process.env.LISTEN_FDS = "";
    process.env.BRANCHKIT_LISTEN_RELAY = relay.rendezvous;
    process.env.BRANCHKIT_LISTEN_RELAY_TOKEN = token;
    process.env.BRANCHKIT_LISTEN_PORTS = `trial=${relay.publicPort}`;
    delete process.env.BRANCHKIT_PLUGIN_DIR;
    try {
      const listener = await ListenLocal({} as never);
      expect(listener.addr()).toBe(`127.0.0.1:${relay.publicPort}`);
      listener.handleFunc("GET", "/ping", (_req, res) => {
        res.writeHead(200);
        res.end("pong");
      });
      listener.serve();
      await new Promise((r) => setTimeout(r, 100)); // let the pool park
      for (let i = 0; i < 3; i++) {
        const ok = await get(relay.publicPort, "/ping", listener.getToken());
        expect(ok).toEqual({ status: 200, body: "pong" });
      }
      const denied = await get(relay.publicPort, "/ping");
      expect(denied.status).toBe(401);
      listener.shutdown();
    } finally {
      process.env = saved;
      relay.stop();
    }
  });
});

describe("relayEnv", () => {
  test("parses a Windows npipe:// rendezvous as a pipe path", () => {
    const prevR = process.env.BRANCHKIT_LISTEN_RELAY;
    const prevT = process.env.BRANCHKIT_LISTEN_RELAY_TOKEN;
    try {
      process.env.BRANCHKIT_LISTEN_RELAY = "npipe://\\\\.\\pipe\\branchkit-relay-x";
      process.env.BRANCHKIT_LISTEN_RELAY_TOKEN = "deadbeef";
      const env = relayEnv();
      expect(env).not.toBeNull();
      expect(env!.rendezvous).toEqual({ path: "\\\\.\\pipe\\branchkit-relay-x" });
      expect(env!.token).toBe("deadbeef");
      // a loopback rendezvous still parses as host:port
      process.env.BRANCHKIT_LISTEN_RELAY = "127.0.0.1:54321";
      expect(relayEnv()!.rendezvous).toEqual({ host: "127.0.0.1", port: 54321 });
      // an empty pipe name is rejected
      process.env.BRANCHKIT_LISTEN_RELAY = "npipe://";
      expect(relayEnv()).toBeNull();
    } finally {
      if (prevR === undefined) delete process.env.BRANCHKIT_LISTEN_RELAY;
      else process.env.BRANCHKIT_LISTEN_RELAY = prevR;
      if (prevT === undefined) delete process.env.BRANCHKIT_LISTEN_RELAY_TOKEN;
      else process.env.BRANCHKIT_LISTEN_RELAY_TOKEN = prevT;
    }
  });
});
