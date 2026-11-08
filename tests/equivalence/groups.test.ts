import { describe, expect, it } from "vitest";
import { classifyVector, GROUP_ORDER } from "../../src/equivalence/classify.js";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { buildReport, createGroupCounters } from "../../src/equivalence/report.js";

describe("group attachment and summaries", () => {
  it("sets each case group from classifyVector", () => {
    for (const c of generateCases(INTEREST, 50, 7)) {
      expect(c.group).toBe(classifyVector(INTEREST, c.lines));
    }
  });

  it("reports all four groups in GROUP_ORDER with conclusive counts summing to conclusiveCount", () => {
    const counters = createGroupCounters();
    counters["standard computation"].matched = 3;
    counters["field overflow behavior"].mismatched = 2;
    const report = buildReport({
      seed: 1,
      casesRun: 5,
      matchedCount: 3,
      mismatches: [
        { input: ["a"], oracleOutput: "x", candidateOutput: "y", group: "field overflow behavior" },
        { input: ["b"], oracleOutput: "x", candidateOutput: "y", group: "field overflow behavior" },
      ],
      groupCounters: counters,
      elapsedMs: 0,
    });
    expect(report.groups.map((g) => g.group)).toEqual([...GROUP_ORDER]);
    expect(report.groups.reduce((s, g) => s + g.conclusive, 0)).toBe(report.conclusiveCount);
  });
});
