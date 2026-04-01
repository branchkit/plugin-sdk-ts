import { describe, test, expect } from "bun:test";
import { createServer } from "node:http";
import { UpstreamClient } from "../upstream.js";

function startTestServer(handler: (req: any, res: any) => void): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => server.close(),
      });
    });
  });
}

describe("UpstreamClient", () => {
  test("do() sends GET request and returns response", async () => {
    const srv = await startTestServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, method: req.method, url: req.url }));
    });

    try {
      const client = new UpstreamClient(srv.url);
      const resp = await client.do("GET", "/test");
      expect(resp.status).toBe(200);
      const body = await resp.json();
      expect(body.ok).toBe(true);
      expect(body.method).toBe("GET");
      expect(body.url).toBe("/test");
    } finally {
      srv.close();
    }
  });

  test("do() sends POST with body and Content-Type header", async () => {
    let receivedContentType = "";
    let receivedBody = "";
    const srv = await startTestServer((req, res) => {
      receivedContentType = req.headers["content-type"] ?? "";
      let data = "";
      req.on("data", (chunk: Buffer) => { data += chunk; });
      req.on("end", () => {
        receivedBody = data;
        res.writeHead(200);
        res.end("ok");
      });
    });

    try {
      const client = new UpstreamClient(srv.url);
      await client.do("POST", "/submit", JSON.stringify({ key: "value" }));
      expect(receivedContentType).toBe("application/json");
      expect(JSON.parse(receivedBody)).toEqual({ key: "value" });
    } finally {
      srv.close();
    }
  });

  test("do() does not set Content-Type when body is null", async () => {
    let receivedContentType: string | undefined;
    const srv = await startTestServer((req, res) => {
      receivedContentType = req.headers["content-type"];
      res.writeHead(200);
      res.end("ok");
    });

    try {
      const client = new UpstreamClient(srv.url);
      await client.do("GET", "/no-body");
      expect(receivedContentType).toBeUndefined();
    } finally {
      srv.close();
    }
  });

  test("healthy() returns true for reachable server", async () => {
    const srv = await startTestServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    try {
      const client = new UpstreamClient(srv.url);
      const ok = await client.healthy();
      expect(ok).toBe(true);
    } finally {
      srv.close();
    }
  });

  test("healthy() returns false for unreachable server", async () => {
    const client = new UpstreamClient("http://127.0.0.1:1");
    const ok = await client.healthy();
    expect(ok).toBe(false);
  });

  test("healthy() caches result for 2 seconds", async () => {
    let requestCount = 0;
    const srv = await startTestServer((_req, res) => {
      requestCount++;
      res.writeHead(200);
      res.end("ok");
    });

    try {
      const client = new UpstreamClient(srv.url);
      await client.healthy();
      await client.healthy();
      await client.healthy();
      // Only one actual request should have been made (cached)
      expect(requestCount).toBe(1);
    } finally {
      srv.close();
    }
  });
});
