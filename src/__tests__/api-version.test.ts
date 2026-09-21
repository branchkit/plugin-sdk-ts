import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { apiVersion } from "../plugin.js";
import { APIVersion } from "../contracts_gen.js";

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
    // Compared against the GENERATED constant, not a literal. This asserted
    // "0.1.0" until 2026-09-21 and went red the moment the contract said
    // 0.2.0 — a test that pins a version it does not own breaks on every
    // bump and teaches nothing when it does.
    expect(v).toBe(APIVersion);
  });
});
