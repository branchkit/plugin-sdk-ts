import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { matchesTopic } from "../topic.js";

interface Row {
  pattern: string;
  topic: string;
  subscription: boolean;
}

// The platform's topic conformance table, subscription column. The copy in
// testdata/ is byte-identical to the platform's (a platform-side gate holds
// it there), so these are the same answers the delivery gate is tested
// against: a pattern listener routes exactly what delivery sends.
const table = JSON.parse(
  readFileSync(new URL("./testdata/topic-match-conformance.json", import.meta.url), "utf8"),
) as { cases: Row[] };

describe("matchesTopic", () => {
  it("runs the conformance table's subscription column", () => {
    const failures = table.cases
      .filter((c) => typeof c.subscription !== "boolean" || matchesTopic(c.pattern, c.topic) !== c.subscription)
      .map((c) => `${JSON.stringify(c.pattern)} vs ${JSON.stringify(c.topic)} should be ${c.subscription}`);
    expect(failures).toEqual([]);
    // A truncated or stale copy must not pass by having nothing to say.
    expect(table.cases.length).toBeGreaterThanOrEqual(40);
    expect(table.cases.filter((c) => c.pattern.includes("**")).length).toBeGreaterThanOrEqual(10);
  });

  it("stays polynomial with many globstars", () => {
    const pattern = "**.".repeat(40) + "z";
    const topic = Array(400).fill("a").join(".");
    expect(matchesTopic(pattern, topic)).toBe(false);
    expect(matchesTopic(pattern, topic + ".z")).toBe(true);
  });
});
