import { describe, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";
import type { RunResult } from "../../src/equivalence/oracle-port.js";

type NonOkStatus = Exclude<RunResult["status"], "ok">;
const NON_OK: readonly NonOkStatus[] = ["timeout", "resource_limit", "environment_error", "compile_error"];

type Plan =
  | { readonly kind: "match" }
  | { readonly kind: "mismatch" }
  | { readonly kind: "inconclusive"; readonly status: NonOkStatus; readonly message: string | undefined };

const planArb: fc.Arbitrary<Plan> = fc.oneof(
  fc.constant<Plan>({ kind: "match" }),
  fc.constant<Plan>({ kind: "mismatch" }),
  fc.record({
    kind: fc.constant<"inconclusive">("inconclusive"),
    status: fc.constantFrom(...NON_OK),
    message: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  }),
);

/** Mixed plans, plus all-inconclusive and no-inconclusive extremes. */
const plansArb: fc.Arbitrary<Plan[]> = fc.oneof(
  fc.array(planArb, { minLength: 1, maxLength: 60 }),
  fc.array(
    fc.record({
      kind: fc.constant<"inconclusive">("inconclusive"),
      status: fc.constantFrom(...NON_OK),
      message: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 60 },
  ),
);

function candidateText(lines: readonly string[]): string {
  return `out:${lines.join("|")}`;
}

function nonOkResult(status: NonOkStatus, message: string | undefined): RunResult {
  const result = failResult(status, message ?? "");
  if (message === undefined) delete (result as { message?: string }).message;
  return result;
}

describe("Property 12: Inconclusive cases are recorded and excluded from the score", () => {
  // Feature: equivalence-engine, Property 12: Inconclusive cases are recorded and excluded from the score
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.1, 7.3**
  it("records non-ok Oracle results as Inconclusive_Cases and scores only conclusive cases", async () => {
    await fc.assert(
      fc.asyncProperty(plansArb, fc.integer({ min: 0, max: 2147483647 }), async (plans, seed) => {
        const caseCount = plans.length;
        const cases = generateCases(INTEREST, caseCount, seed);

        const oracle = createFakeOracle({
          run: ({ callIndex, inputLines }) => {
            const plan = plans[callIndex];
            // Calls beyond the main loop (shrinking) are never conclusive.
            if (plan === undefined) return failResult("timeout", "shrink");
            if (plan.kind === "inconclusive") return nonOkResult(plan.status, plan.message);
            const text = candidateText(inputLines);
            return okResult(plan.kind === "match" ? text : `${text}!`);
          },
        });

        const invoked: string[][] = [];
        const candidate = (lines: string[]): string => {
          invoked.push([...lines]);
          return candidateText(lines);
        };

        const report = await runEquivalence({
          source: "IDENTIFICATION DIVISION.",
          fields: INTEREST,
          candidate,
          caseCount,
          seed,
          mismatchListCap: 10000,
          shrinkLimit: 1,
          oracle,
        });

        const expectedInconclusive = plans.flatMap((plan, i) =>
          plan.kind === "inconclusive"
            ? [{ plan, generated: cases[i] as (typeof cases)[number] }]
            : [],
        );
        const matched = plans.filter((p) => p.kind === "match").length;
        const mismatched = plans.filter((p) => p.kind === "mismatch").length;
        const conclusive = matched + mismatched;
        const inconclusive = expectedInconclusive.length;

        // Exactly one InconclusiveCase per non-ok result, in execution order, with full details.
        check(report.inconclusiveCases.length === inconclusive, "one InconclusiveCase per non-ok result");
        expectedInconclusive.forEach(({ plan, generated }, k) => {
          const rec = report.inconclusiveCases[k];
          check(rec !== undefined, "record exists");
          check(plan.kind === "inconclusive", "plan kind");
          if (rec === undefined || plan.kind !== "inconclusive") return;
          check(rec.status === plan.status, `status at ${k}`);
          check(rec.message === (plan.message ?? ""), `message or "" at ${k}`);
          check(rec.group === generated.group, `group at ${k}`);
          check(
            rec.input.length === generated.lines.length && rec.input.every((l, j) => l === generated.lines[j]),
            `input at ${k}`,
          );
        });

        // Candidate is never invoked for non-ok results.
        const expectedInvocations = plans.flatMap((plan, i) =>
          plan.kind === "inconclusive" ? [] : [(cases[i] as (typeof cases)[number]).lines],
        );
        check(invoked.length === conclusive, "Candidate invoked only for ok cases");
        invoked.forEach((lines, k) => {
          const want = expectedInvocations[k] as readonly string[];
          check(lines.length === want.length && lines.every((l, j) => l === want[j]), `invoked input at ${k}`);
        });

        // Counts.
        check(report.casesRun === caseCount, "casesRun includes inconclusive");
        check(report.inconclusiveCount === inconclusive, "inconclusiveCount");
        check(report.conclusiveCount === conclusive, "conclusiveCount excludes inconclusive");
        check(report.matchedCount === matched, "matchedCount");
        check(report.mismatchCount === mismatched, "mismatchCount");
        check(report.containsInconclusive === inconclusive > 0, "containsInconclusive");

        let byStatusSum = 0;
        for (const status of NON_OK) {
          const want = expectedInconclusive.filter((e) => e.plan.kind === "inconclusive" && e.plan.status === status)
            .length;
          const got = report.inconclusiveByStatus[status] ?? 0;
          check(got === want, `inconclusiveByStatus.${status}`);
          byStatusSum += got;
        }
        check(byStatusSum === report.inconclusiveCount, "by-status sums to inconclusiveCount");

        // Inconclusive collection is separate from mismatches.
        check(report.mismatches.length === mismatched, "mismatch list holds only real mismatches");
        check(
          report.mismatches.every((m) => !("status" in m)),
          "mismatch records carry no Oracle status",
        );
        const groupInconclusive = report.groups.reduce((s, g) => s + g.inconclusive, 0);
        const groupConclusive = report.groups.reduce((s, g) => s + g.conclusive, 0);
        check(groupInconclusive === inconclusive, "group inconclusive sums");
        check(groupConclusive === conclusive, "group conclusive sums");

        // Score and outcome.
        if (conclusive === 0) {
          check(report.outcome === "inconclusive", "zero conclusive => inconclusive outcome");
          check(!("matchScore" in report) || report.matchScore === undefined, "no matchScore");
        } else {
          check(report.outcome === "completed", "completed outcome");
          check(report.matchScore === matched / conclusive, "matchScore from conclusive cases only");
        }

        check(oracle.releaseCalls === 1, "handle released once");
      }),
      { numRuns: 100 },
    );
  });
});

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
