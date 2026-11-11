import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { GROUP_ORDER } from "../../src/equivalence/classify.js";
import { INTEREST, PAYROLL, TAX } from "../../src/equivalence/descriptors.js";
import type { EquivalenceReport } from "../../src/equivalence/report.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult, type FakeOracle } from "./doubles/fake-oracle.js";

const CASE_COUNT = 60;
const DESCRIPTORS = [INTEREST, PAYROLL, TAX] as const;

/** How the fake Oracle answers calls made after the main loop (the shrink phase). */
type ShrinkMode = "ok" | "nonok" | "mixed";

/** Small deterministic hash of the input lines. */
function hashLines(lines: readonly string[]): number {
  let h = 7;
  for (const ch of lines.join("|")) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return h;
}

interface Scenario {
  readonly fieldsIndex: number;
  readonly failModulus: number;
  readonly mode: ShrinkMode;
  readonly shrinkLimit: number;
  readonly seed: number;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  fieldsIndex: fc.integer({ min: 0, max: DESCRIPTORS.length - 1 }),
  failModulus: fc.integer({ min: 1, max: 5 }),
  mode: fc.constantFrom<ShrinkMode>("ok", "nonok", "mixed"),
  shrinkLimit: fc.integer({ min: 1, max: 25 }),
  seed: fc.integer({ min: -2147483648, max: 2147483647 }),
});

interface Outcome {
  readonly report: EquivalenceReport;
  readonly oracle: FakeOracle;
}

async function runScenario(s: Scenario, shrinkLimit: number): Promise<Outcome> {
  const oracle = createFakeOracle({
    run: ({ inputLines, callIndex }) => {
      if (callIndex < CASE_COUNT) return okResult("O");
      if (s.mode === "nonok") return failResult("timeout", "slow");
      if (s.mode === "mixed" && hashLines(inputLines) % 3 === 0) {
        return failResult("resource_limit", "big");
      }
      return okResult("O");
    },
  });
  // Deterministic in the input only, so the main phase is identical across runs.
  const candidate = (lines: string[]): string =>
    hashLines(lines) % s.failModulus === 0 ? "X" : "O";
  const report = await runEquivalence({
    source: "IDENTIFICATION DIVISION.",
    fields: DESCRIPTORS[s.fieldsIndex] ?? INTEREST,
    candidate,
    caseCount: CASE_COUNT,
    seed: s.seed,
    shrinkLimit,
    mismatchListCap: 10000,
    oracle,
  });
  return { report, oracle };
}

describe("Property 14: Shrinking is bounded, separate, and only for failing groups", () => {
  // Feature: equivalence-engine, Property 14: Shrinking is bounded, separate, and only for failing groups
  // **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 8.10**
  it("bounds shrink calls, keeps them separate, shrinks only failing groups", async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        const { report, oracle } = await runScenario(s, s.shrinkLimit);
        const failingGroups = new Set(report.mismatches.map((m) => m.group));

        // 8.1 / 8.2: bounded per group, and zero for groups without a Mismatch.
        let shrinkTotal = 0;
        for (const group of GROUP_ORDER) {
          const calls = report.shrinkOracleCalls[group];
          expect(calls).toBeGreaterThanOrEqual(0);
          expect(calls).toBeLessThanOrEqual(s.shrinkLimit);
          if (!failingGroups.has(group)) expect(calls).toBe(0);
          shrinkTotal += calls;
        }

        // 8.3: shrink calls are separate from casesRun and account for every extra Oracle run.
        expect(report.casesRun).toBe(CASE_COUNT);
        expect(oracle.runCalls).toBe(CASE_COUNT + shrinkTotal);

        // 8.3: counts and score are unaffected by shrinking.
        const baseline = await runScenario(s, 1);
        expect(report.casesRun).toBe(baseline.report.casesRun);
        expect(report.matchedCount).toBe(baseline.report.matchedCount);
        expect(report.mismatchCount).toBe(baseline.report.mismatchCount);
        expect(report.matchScore).toBe(baseline.report.matchScore);
        expect(report.groups).toEqual(baseline.report.groups);
        expect(report.mismatchCount).toBe(report.mismatches.length);
        expect(report.groups.reduce((n, g) => n + g.conclusive, 0)).toBe(report.conclusiveCount);
        expect(report.conclusiveCount).toBe(report.matchedCount + report.mismatchCount);
        if (report.conclusiveCount > 0) {
          expect(report.matchScore).toBe(report.matchedCount / report.conclusiveCount);
        }

        // 8.4 / 8.5: at most one example per failing group, none otherwise, in group order.
        const exampleGroups = report.shrunkExamples.map((e) => e.group);
        expect(new Set(exampleGroups).size).toBe(exampleGroups.length);
        expect(exampleGroups).toEqual(GROUP_ORDER.filter((g) => failingGroups.has(g)));

        for (const example of report.shrunkExamples) {
          // 8.5: complete example that is still a real failure.
          expect(typeof example.group).toBe("string");
          expect(Array.isArray(example.input)).toBe(true);
          expect(example.input.length).toBe((DESCRIPTORS[s.fieldsIndex] ?? INTEREST).length);
          expect(typeof example.oracleOutput).toBe("string");
          expect(typeof example.candidateOutput).toBe("string");
          expect(example.oracleOutput).not.toBe(example.candidateOutput);

          // 8.8: when no smaller failure exists the start vector is reported.
          if (s.mode === "nonok") {
            const start = report.mismatches.find((m) => m.group === example.group);
            expect(start).toBeDefined();
            expect(example.input).toEqual(start?.input);
            expect(example.oracleOutput).toBe(start?.oracleOutput);
            expect(example.candidateOutput).toBe(start?.candidateOutput);
            // 8.10: non-ok results never count as failing, so nothing was adopted.
            expect(report.shrinkOracleCalls[example.group]).toBeLessThanOrEqual(s.shrinkLimit);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("reports the start vector when the Candidate matches everywhere else", async () => {
    // Candidate fails only on the exact input of the first main-phase case.
    let firstInput: string | undefined;
    const oracle = createFakeOracle({
      run: ({ inputLines, callIndex }) => {
        if (callIndex === 0) firstInput = inputLines.join("|");
        return okResult("O");
      },
    });
    const report = await runEquivalence({
      source: "IDENTIFICATION DIVISION.",
      fields: TAX,
      candidate: (lines) => (lines.join("|") === firstInput ? "X" : "O"),
      caseCount: 5,
      seed: 1,
      shrinkLimit: 10,
      oracle,
    });
    expect(report.mismatchCount).toBeGreaterThanOrEqual(1);
    expect(report.shrunkExamples.length).toBe(1);
    expect(report.shrunkExamples[0]?.input.join("|")).toBe(firstInput);
  });
});
