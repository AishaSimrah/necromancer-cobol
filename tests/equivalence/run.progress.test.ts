import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import type { ProgressEvent } from "../../src/equivalence/report.js";
import type { RunResult } from "../../src/equivalence/oracle-port.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";

type Plan = "match" | "mismatch" | "inconclusive";
type CallbackMode = "ok" | "throw" | "reject";

const plansArb: fc.Arbitrary<Plan[]> = fc.array(
  fc.constantFrom<Plan>("match", "mismatch", "inconclusive"),
  { minLength: 1, maxLength: 50 },
);

function candidateText(lines: readonly string[]): string {
  return `out:${lines.join("|")}`;
}

function scriptFor(plans: readonly Plan[]): (ctx: { callIndex: number; inputLines: readonly string[] }) => RunResult {
  return ({ callIndex, inputLines }) => {
    const plan = plans[callIndex] as Plan;
    if (plan === "inconclusive") return failResult("timeout", "slow");
    return okResult(plan === "match" ? candidateText(inputLines) : "different");
  };
}

async function runWith(
  plans: readonly Plan[],
  seed: number,
  onProgress: ((e: ProgressEvent) => void | Promise<void>) | undefined,
) {
  const oracle = createFakeOracle({ run: scriptFor(plans) });
  const report = await runEquivalence({
    source: "IDENTIFICATION DIVISION.",
    fields: INTEREST,
    candidate: (lines) => candidateText(lines),
    caseCount: plans.length,
    seed,
    oracle,
    ...(onProgress !== undefined ? { onProgress } : {}),
  });
  return report;
}

function withoutElapsed<T extends { elapsedMs: number }>(report: T): Omit<T, "elapsedMs"> {
  const { elapsedMs: _elapsed, ...rest } = report;
  return rest;
}

describe("Property 16: Progress events are consistent and isolated from results", () => {
  // Feature: equivalence-engine, Property 16: Progress events are consistent and isolated from results
  // **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6**
  it("emits one consistent event per finished case, with no score", async () => {
    await fc.assert(
      fc.asyncProperty(plansArb, fc.integer({ min: -1000, max: 1000 }), async (plans, seed) => {
        const events: ProgressEvent[] = [];
        const report = await runWith(plans, seed, (e) => {
          events.push(e);
        });
        const cases = generateCases(INTEREST, plans.length, seed);

        expect(events).toHaveLength(report.casesRun);
        expect(events).toHaveLength(plans.length);
        events.forEach((e, i) => {
          expect(e.completed).toBe(i + 1);
          expect(e.target).toBe(plans.length);
          expect(e.group).toBe(cases[i]?.group);
          expect(e.matched + e.mismatches + e.inconclusive).toBe(e.completed);
          for (const n of [e.matched, e.mismatches, e.inconclusive]) {
            expect(n).toBeGreaterThanOrEqual(0);
            expect(n).toBeLessThanOrEqual(e.completed);
          }
          expect(Object.keys(e).sort()).toEqual(
            ["completed", "group", "inconclusive", "matched", "mismatches", "target"],
          );
          expect("score" in e || "matchScore" in e).toBe(false);
        });
        const last = events[events.length - 1] as ProgressEvent;
        expect(last.matched).toBe(report.matchedCount);
        expect(last.mismatches).toBe(report.mismatchCount);
        expect(last.inconclusive).toBe(report.inconclusiveCount);
      }),
      { numRuns: 100 },
    );
  });

  it("is unaffected by a throwing or rejecting callback, and by having no callback", async () => {
    await fc.assert(
      fc.asyncProperty(
        plansArb,
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom<CallbackMode>("throw", "reject"),
        async (plans, seed, mode) => {
          const baseline = await runWith(plans, seed, undefined);

          let calls = 0;
          const faulty = await runWith(plans, seed, () => {
            calls++;
            if (mode === "throw") throw new Error("boom");
            return Promise.reject(new Error("rejected"));
          });

          expect(calls).toBe(plans.length);
          expect(withoutElapsed(faulty)).toEqual(withoutElapsed(baseline));
          expect(baseline.casesRun).toBe(plans.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
