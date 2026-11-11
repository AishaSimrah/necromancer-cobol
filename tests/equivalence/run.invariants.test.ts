import { describe, it } from "vitest";
import fc from "fast-check";
import { GROUP_ORDER } from "../../src/equivalence/classify.js";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";

type Plan = "match" | "mismatch" | "inconclusive";

const planArb: fc.Arbitrary<Plan> = fc.constantFrom<Plan>("match", "mismatch", "inconclusive");

/** Mixed plans plus clean (all match) and all-inconclusive extremes. */
const plansArb: fc.Arbitrary<Plan[]> = fc.oneof(
  { weight: 4, arbitrary: fc.array(planArb, { minLength: 1, maxLength: 60 }) },
  {
    weight: 2,
    arbitrary: fc.array(fc.constant<Plan>("match"), { minLength: 1, maxLength: 60 }),
  },
  {
    weight: 1,
    arbitrary: fc.array(fc.constant<Plan>("inconclusive"), { minLength: 1, maxLength: 20 }),
  },
);

function candidateText(lines: readonly string[]): string {
  return `out:${lines.join("|")}`;
}

describe("Property 13: Report count invariants", () => {
  // Feature: equivalence-engine, Property 13: Report count invariants
  // **Validates: Requirements 4.8, 4.9, 7.1, 7.2, 7.4, 7.5, 7.8, 7.9, 7.10, 7.11**
  it("keeps counts, groups, score, cap and truncation flag consistent", async () => {
    await fc.assert(
      fc.asyncProperty(
        plansArb,
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 0, max: 2147483647 }),
        async (plans, cap, seed) => {
          const caseCount = plans.length;
          const oracle = createFakeOracle({
            run: ({ callIndex, inputLines }) => {
              const plan = plans[callIndex];
              // Calls beyond the main loop come from shrinking: never failing.
              if (plan === undefined || plan === "inconclusive") return failResult("timeout", "t");
              const text = candidateText(inputLines);
              return okResult(plan === "match" ? text : `${text}!`);
            },
          });

          const report = await runEquivalence({
            source: "IDENTIFICATION DIVISION.",
            fields: INTEREST,
            candidate: (lines: string[]): string => candidateText(lines),
            caseCount,
            seed,
            mismatchListCap: cap,
            shrinkLimit: 5,
            oracle,
          });

          check(report.matchedCount + report.mismatchCount === report.conclusiveCount, "matched + mismatch = conclusive");
          check(report.conclusiveCount + report.inconclusiveCount === report.casesRun, "conclusive + inconclusive = casesRun");
          check(report.casesRun === caseCount, "casesRun equals planned cases");

          // Four groups, in order, conclusive counts sum to conclusiveCount.
          check(report.groups.length === 4, "four groups");
          GROUP_ORDER.forEach((g, i) => check(report.groups[i]?.group === g, `group order at ${i}`));
          check(
            report.groups.reduce((s, g) => s + g.conclusive, 0) === report.conclusiveCount,
            "group conclusive sums to conclusiveCount",
          );

          // Score.
          if (report.conclusiveCount > 0) {
            check(report.matchScore !== undefined, "matchScore present");
            const score = report.matchScore as number;
            check(score >= 0 && score <= 1, "matchScore in [0,1]");
            check(score === report.matchedCount / report.conclusiveCount, "matchScore = matched / conclusive");
          } else {
            check(report.matchScore === undefined, "matchScore absent when no conclusive case");
          }

          // Mismatch list and truncation flag.
          check(report.mismatches.length === Math.min(report.mismatchCount, cap), "mismatches.length = min(count, cap)");
          check(report.mismatchListTruncated === report.mismatchCount > cap, "truncated iff count > cap");
          for (const m of report.mismatches) {
            check(Array.isArray(m.input) && m.input.length === INTEREST.length, "mismatch input");
            check(typeof m.oracleOutput === "string", "mismatch oracleOutput");
            check(typeof m.candidateOutput === "string", "mismatch candidateOutput");
            check(GROUP_ORDER.includes(m.group), "mismatch group");
          }

          // Clean and failing runs.
          if (report.conclusiveCount > 0 && report.mismatchCount === 0) {
            check(report.matchScore === 1, "clean run scores 1");
            check(report.mismatches.length === 0, "clean run has no mismatches");
            check(report.shrunkExamples.length === 0, "clean run has no shrunk examples");
          }
          if (report.mismatchCount > 0) {
            check((report.matchScore as number) < 1, "any mismatch scores below 1");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
