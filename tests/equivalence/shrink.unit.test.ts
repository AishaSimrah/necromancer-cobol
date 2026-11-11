import { describe, expect, it } from "vitest";
import { GROUP_ORDER, type EvidenceGroup } from "../../src/equivalence/classify.js";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

const SOURCE = "IDENTIFICATION DIVISION.";
const CASE_COUNT = 200;
const SEED = 1;

/** Groups that have at least one Mismatch, in GROUP_ORDER. */
function failingGroupsOf(mismatchGroups: readonly EvidenceGroup[]): EvidenceGroup[] {
  const set = new Set(mismatchGroups);
  return GROUP_ORDER.filter((g) => set.has(g));
}

describe("Shrinking phase (unit)", () => {
  // **Validates: Requirements 8.7**
  it("starts shrinking only after all cases have finished", async () => {
    let completed = 0;
    const completedAtShrinkCall: number[] = [];
    const oracle = createFakeOracle({
      run: ({ callIndex }) => {
        if (callIndex >= CASE_COUNT) completedAtShrinkCall.push(completed);
        return okResult("O");
      },
    });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "X",
      caseCount: CASE_COUNT,
      seed: SEED,
      shrinkLimit: 5,
      oracle,
      onProgress: (p) => {
        completed = p.completed;
      },
    });

    expect(report.casesRun).toBe(CASE_COUNT);
    expect(completedAtShrinkCall.length).toBeGreaterThan(0);
    expect(completedAtShrinkCall.every((c) => c === CASE_COUNT)).toBe(true);
    expect(oracle.callOrder[oracle.callOrder.length - 1]).toBe("releaseHandle");
  });

  // **Validates: Requirements 8.9**
  it("sets limitReached when the Oracle call limit stops shrinking", async () => {
    const limit = 1;
    const oracle = createFakeOracle({ run: okResult("O") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "X", // every vector fails, so shrinking keeps asking for more calls
      caseCount: CASE_COUNT,
      seed: SEED,
      shrinkLimit: limit,
      oracle,
    });

    expect(report.shrunkExamples.length).toBeGreaterThan(0);
    // A group whose start vector is already minimal can finish early; the rest hit the limit.
    const limited = report.shrunkExamples.filter((e) => e.limitReached);
    expect(limited.length).toBeGreaterThan(0);
    for (const example of limited) {
      expect(report.shrinkOracleCalls[example.group]).toBe(limit);
    }
    for (const example of report.shrunkExamples.filter((e) => !e.limitReached)) {
      expect(report.shrinkOracleCalls[example.group]).toBeLessThanOrEqual(limit);
    }
  });

  // **Validates: Requirements 8.11**
  it("keeps best-so-far and skips later groups when aborted during shrinking", async () => {
    const controller = new AbortController();
    const oracle = createFakeOracle({
      run: ({ callIndex }) => {
        if (callIndex === CASE_COUNT) controller.abort(); // first shrink call
        return okResult("O");
      },
    });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "X",
      caseCount: CASE_COUNT,
      seed: SEED,
      shrinkLimit: 50,
      signal: controller.signal,
      oracle,
    });

    const failing = failingGroupsOf(report.mismatches.map((m) => m.group));
    expect(failing.length).toBeGreaterThanOrEqual(2);
    const firstGroup = failing[0];

    expect(report.aborted).toBe(true);
    expect(report.casesRun).toBe(CASE_COUNT);
    // Only the group being shrunk when the abort fired has an example.
    expect(report.shrunkExamples.map((e) => e.group)).toEqual([firstGroup]);
    const example = report.shrunkExamples[0];
    expect(example?.input.length).toBe(INTEREST.length);
    expect(example?.oracleOutput).toBe("O");
    expect(example?.candidateOutput).toBe("X");
    // Later groups were skipped without any Oracle call.
    for (const group of failing.slice(1)) {
      expect(report.shrinkOracleCalls[group]).toBe(0);
    }
    expect(oracle.releaseCalls).toBe(1);
  });

  // **Validates: Requirements 12.10**
  it("gives one Shrunk_Example per mismatching group and leaves casesRun unchanged", async () => {
    const build = (shrinkLimit: number) =>
      runEquivalence({
        source: SOURCE,
        fields: INTEREST,
        candidate: () => "X",
        caseCount: CASE_COUNT,
        seed: SEED,
        shrinkLimit,
        oracle: createFakeOracle({ run: okResult("O") }),
      });
    const report = await build(10);
    const baseline = await build(1);

    const failing = failingGroupsOf(report.mismatches.map((m) => m.group));
    expect(failing.length).toBeGreaterThanOrEqual(2);
    expect(report.shrunkExamples.map((e) => e.group)).toEqual(failing);
    expect(report.casesRun).toBe(CASE_COUNT);
    expect(report.casesRun).toBe(baseline.casesRun);
    expect(report.mismatchCount).toBe(baseline.mismatchCount);
  });
});
