import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { apiVersion } from "../plugin.js";

describe("apiVersion", () => {
  const origEnv = process.env.BRANCHKIT_API_VERSION;

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.BRANCHKIT_API_VERSION = origEnv;
    } else {
      delete process.env.BRANCHKIT_API_VERSION;
    }
  });

  it("returns env var when set", () => {
    process.env.BRANCHKIT_API_VERSION = "0.2.0";
    expect(apiVersion()).toBe("0.2.0");
  });

  it("falls back to compiled constant when env var is unset", () => {
    delete process.env.BRANCHKIT_API_VERSION;
    const v = apiVersion();
    expect(v).toBeTruthy();
    expect(v).toBe("0.1.0");
  });
});
