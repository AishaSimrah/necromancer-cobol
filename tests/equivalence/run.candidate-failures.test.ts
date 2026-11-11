import { describe, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";
import type { RunResult } from "../../src/equivalence/oracle-port.js";

const CASE_COUNT = 100;

type FailureKind =
  | "throwError"
  | "rejectError"
  | "throwString"
  | "rejectString"
  | "returnNumber"
  | "returnUndefined"
  | "returnNull"
  | "returnObject"
  | "resolveNumber";

const FAILURE_KINDS: readonly FailureKind[] = [
  "throwError",
  "rejectError",
  "throwString",
  "rejectString",
  "returnNumber",
  "returnUndefined",
  "returnNull",
  "returnObject",
  "resolveNumber",
];

type NonOkStatus = Exclude<RunResult["status"], "ok">;
const NON_OK: readonly NonOkStatus[] = ["timeout", "resource_limit", "environment_error", "compile_error"];

interface CasePlan {
  /** Oracle status for this case: "ok" or a non-ok status. */
  readonly status: "ok" | NonOkStatus;
  readonly kind: FailureKind;
  readonly text: string;
}

const planArb: fc.Arbitrary<CasePlan> = fc.record({
  status: fc.oneof(
    { weight: 3, arbitrary: fc.constant<"ok">("ok") },
    { weight: 1, arbitrary: fc.constantFrom<"ok" | NonOkStatus>(...NON_OK) },
  ),
  kind: fc.constantFrom(...FAILURE_KINDS),
  text: fc.string({ maxLength: 16 }),
});

const plansArb = fc.array(planArb, { minLength: CASE_COUNT, maxLength: CASE_COUNT });

/** The error text the engine must record for a failure of this kind. */
function expectedText(plan: CasePlan): string {
  switch (plan.kind) {
    case "throwError":
    case "rejectError":
    case "throwString":
    case "rejectString":
      return plan.text;
    case "returnNumber":
    case "resolveNumber":
      return "Candidate returned non-string output: number";
    case "returnUndefined":
      return "Candidate returned non-string output: undefined";
    case "returnNull":
    case "returnObject":
      return "Candidate returned non-string output: object";
  }
}

/** Builds a Candidate that fails in the planned way. The cast is the only way to model non-string returns. */
function failingCandidate(plan: CasePlan): () => string | Promise<string> {
  const asString = (value: unknown): string => value as string;
  switch (plan.kind) {
    case "throwError":
      return () => {
        throw new Error(plan.text);
      };
    case "rejectError":
      return () => Promise.reject(new Error(plan.text));
    case "throwString":
      return () => {
        throw plan.text;
      };
    case "rejectString":
      return () => Promise.reject(plan.text) as Promise<string>;
    case "returnNumber":
      return () => asString(42);
    case "returnUndefined":
      return () => asString(undefined);
    case "returnNull":
      return () => asString(null);
    case "returnObject":
      return () => asString({ text: plan.text });
    case "resolveNumber":
      return () => Promise.resolve(asString(7));
  }
}

describe("Property 10: Candidate failures are Mismatches, never run failures", () => {
  // Feature: equivalence-engine, Property 10: Candidate failures are Mismatches, never run failures
  // **Validates: Requirements 2.6, 2.7, 5.6, 5.7**
  it("records failing Candidates as Mismatches only on ok cases, continues, and releases once", async () => {
    await fc.assert(
      fc.asyncProperty(plansArb, fc.integer({ min: 0, max: 2147483647 }), async (plans, seed) => {
        const oracle = createFakeOracle({
          run: ({ callIndex }) => {
            const plan = plans[callIndex];
            if (plan === undefined) return failResult("timeout", "shrink phase"); // not failing
            return plan.status === "ok" ? okResult(`out-${callIndex}`) : failResult(plan.status, "x");
          },
        });

        const okPlans = plans.filter((p) => p.status === "ok");
        let invocations = 0;
        const candidate = (): string | Promise<string> => {
          const plan = okPlans[invocations];
          invocations++;
          return plan === undefined ? "" : failingCandidate(plan)();
        };

        const report = await runEquivalence({
          source: "IDENTIFICATION DIVISION.",
          fields: INTEREST,
          candidate,
          caseCount: CASE_COUNT,
          seed,
          mismatchListCap: 10000,
          oracle,
        });

        const nonOkCount = plans.length - okPlans.length;
        check(report.casesRun === CASE_COUNT, "run continued through all cases");
        const shrinkCalls = Object.values(report.shrinkOracleCalls).reduce((a, b) => a + b, 0);
        check(oracle.runCalls === CASE_COUNT + shrinkCalls, "Oracle ran every case (plus shrink calls)");
        check(invocations === okPlans.length, "Candidate invoked only for ok cases");
        check(report.outcome !== "oracle_unavailable", "not an unavailable outcome");
        check(report.mismatchCount === okPlans.length, "every ok case is a Mismatch");
        check(report.matchedCount === 0, "no matches");
        check(report.conclusiveCount === okPlans.length, "conclusive = ok cases");
        check(report.inconclusiveCount === nonOkCount, "non-ok cases are inconclusive, not Mismatches");
        check(report.mismatches.length === okPlans.length, "mismatch list complete");

        okPlans.forEach((plan, k) => {
          const m = report.mismatches[k];
          check(m !== undefined, "mismatch exists");
          check(m?.candidateOutput === expectedText(plan), `candidateOutput carries error text at ${k}`);
        });

        check(oracle.compileCalls === 1, "compiled once");
        check(oracle.releaseCalls === 1, "releaseHandle called exactly once");
        check(oracle.liveHandleIds.length === 0, "no handle leaked");
      }),
      { numRuns: 100 },
    );
  });
});

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
