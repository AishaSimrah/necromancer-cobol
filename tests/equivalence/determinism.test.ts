import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import type { EquivalenceReport } from "../../src/equivalence/index.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";

const CASE_COUNT = 40;

/** Small deterministic string hash (pure function of the input lines). */
function hashLines(lines: readonly string[]): number {
  let h = 17;
  for (const ch of lines.join("|")) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h;
}

/**
 * Runs the engine once with a fresh fake Oracle whose answers are a pure function of the input.
 * The Candidate disagrees on some inputs and the Oracle is inconclusive on others, so the
 * report holds mismatches, shrunk examples and inconclusive cases.
 */
async function runOnce(seed: number): Promise<EquivalenceReport> {
  const oracle = createFakeOracle({
    run: ({ inputLines }) => {
      const h = hashLines(inputLines);
      if (h % 13 === 0) return failResult("timeout", "fake timeout");
      return okResult(`OUT:${inputLines.join("|")}`);
    },
  });
  const candidate = (lines: string[]): string => {
    const h = hashLines(lines);
    return h % 5 === 0 ? `BAD:${lines.join("|")}` : `OUT:${lines.join("|")}`;
  };
  return runEquivalence({
    source: "IDENTIFICATION DIVISION.",
    fields: INTEREST,
    candidate,
    caseCount: CASE_COUNT,
    seed,
    mismatchListCap: 5,
    shrinkLimit: 30,
    oracle,
  });
}

/** Removes the only wall-clock dependent field. */
function withoutElapsed(report: EquivalenceReport): Omit<EquivalenceReport, "elapsedMs"> {
  const { elapsedMs: _elapsedMs, ...rest } = report;
  return rest;
}

async function expectSameReport(seed: number): Promise<void> {
  const first = await runOnce(seed);
  const second = await runOnce(seed);
  expect(withoutElapsed(second)).toEqual(withoutElapsed(first));
  // The scenario must exercise the interesting report parts, or the comparison proves little.
  expect(first.seed).toBe(seed);
  expect(first.casesRun).toBe(CASE_COUNT);
}

describe("Property 15: same inputs, same report", () => {
  // Feature: equivalence-engine, Property 15: Same inputs, same report
  // **Validates: Requirements 7.6, 9.6, 9.7, 11.5**
  it("two runs with identical config give equal reports (ignoring elapsedMs)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: -2147483648, max: 2147483647 }), async (seed) => {
        await expectSameReport(seed);
      }),
      { numRuns: 100 },
    );
  });

  it("holds for at least 20 distinct seeds and the reports contain mismatches and inconclusive cases", async () => {
    const seeds = Array.from({ length: 25 }, (_, i) => i * 7919 + 1);
    expect(new Set(seeds).size).toBeGreaterThanOrEqual(20);
    let sawMismatch = false;
    let sawInconclusive = false;
    for (const seed of seeds) {
      await expectSameReport(seed);
      const report = await runOnce(seed);
      sawMismatch ||= report.mismatchCount > 0 && report.shrunkExamples.length > 0;
      sawInconclusive ||= report.inconclusiveCount > 0;
    }
    expect(sawMismatch).toBe(true);
    expect(sawInconclusive).toBe(true);
  });
});
