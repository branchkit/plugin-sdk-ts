import { describe, test, expect, mock } from "bun:test";
import { Log } from "../log.js";

describe("Log", () => {
  test("writes to stderr with plugin ID prefix", () => {
    const written: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string) => { written.push(chunk); return true; }) as any;
    try {
      Log("test-plugin", "hello world");
      expect(written).toEqual(["[test-plugin] hello world\n"]);
    } finally {
      process.stderr.write = orig;
    }
  });

  test("joins multiple args with spaces", () => {
    const written: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string) => { written.push(chunk); return true; }) as any;
    try {
      Log("p", "a", "b", "c");
      expect(written).toEqual(["[p] a b c\n"]);
    } finally {
      process.stderr.write = orig;
    }
  });

  test("serializes non-string args as JSON", () => {
    const written: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string) => { written.push(chunk); return true; }) as any;
    try {
      Log("p", "count:", 42, { key: "val" });
      expect(written).toEqual(['[p] count: 42 {"key":"val"}\n']);
    } finally {
      process.stderr.write = orig;
    }
  });
});
