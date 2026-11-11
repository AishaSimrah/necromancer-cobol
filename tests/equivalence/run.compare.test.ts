import { describe, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

const CASE_COUNT = 100;

/** Oracle output plus a Candidate output derived to stress strict comparison. */
const pairArb: fc.Arbitrary<readonly [string, string]> = fc
  .tuple(
    fc.string({ maxLength: 12 }),
    fc.constantFrom("same", "space", "newline", "upper", "lower", "crlf", "other"),
    fc.string({ maxLength: 12 }),
  )
  .map(([oracle, kind, other]): readonly [string, string] => {
    const base = oracle + "a\nB";
    switch (kind) {
      case "same":
        return [base, base];
      case "space":
        return [base, base + " "];
      case "newline":
        return [base, base + "\n"];
      case "upper":
        return [base, base.toUpperCase()];
      case "lower":
        return [base, base.toLowerCase()];
      case "crlf":
        return [base, base.replace(/\n/g, "\r\n")];
      default:
        return [oracle, other];
    }
  });

const pairsArb = fc.array(pairArb, { minLength: CASE_COUNT, maxLength: CASE_COUNT });

describe("Property 9: strict comparison and exact counting", () => {
  // Feature: equivalence-engine, Property 9: Strict comparison and exact counting
  // **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
  it("matches iff strings are identical, counts are exact, Candidate gets fresh ordered input", async () => {
    await fc.assert(
      fc.asyncProperty(pairsArb, fc.integer({ min: 0, max: 2147483647 }), async (pairs, seed) => {
        const oracle = createFakeOracle({
          // Calls past CASE_COUNT come from shrinking; answer them with a match.
          run: ({ callIndex }) => okResult(pairs[callIndex]?.[0] ?? ""),
        });
        const seen: string[][] = [];
        const candidate = (lines: string[]): string => {
          const idx = seen.length;
          if (idx >= CASE_COUNT) return pairs[0]?.[0] ?? ""; // shrink phase: never a Mismatch
          seen.push([...lines]);
          // Mutate the received array: must not leak into the engine or later cases.
          lines.push("mutated");
          if (lines.length > 0) lines[0] = "mutated";
          return (pairs[idx] as readonly [string, string])[1];
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

        const runInputs = oracle.callLog
          .flatMap((c) => (c.kind === "runCompiled" ? [c.inputLines] : []))
          .slice(0, CASE_COUNT);
        const expectedMismatches = pairs.filter(([o, c]) => o !== c).length;

        check(report.conclusiveCount === CASE_COUNT, "all cases conclusive");
        check(seen.length === CASE_COUNT, "Candidate invoked exactly once per ok case");
        check(runInputs.length === CASE_COUNT, "Oracle run once per case");
        check(report.mismatchCount === expectedMismatches, "mismatchCount exact");
        check(report.matchedCount === CASE_COUNT - expectedMismatches, "matchedCount exact");
        check(
          report.matchedCount + report.mismatchCount === report.conclusiveCount,
          "matched + mismatches = conclusive",
        );
        check(report.mismatches.length === expectedMismatches, "all mismatches recorded");

        // Candidate saw the same input lines, in order, unaffected by earlier mutation.
        for (let i = 0; i < CASE_COUNT; i++) {
          check(
            JSON.stringify(seen[i]) === JSON.stringify(runInputs[i]),
            `Candidate input equals Oracle input at case ${i}`,
          );
        }

        // Recorded mismatches carry input, both outputs and group, in execution order.
        const expected = pairs
          .map((p, i) => ({ p, i }))
          .filter(({ p }) => p[0] !== p[1]);
        report.mismatches.forEach((m, k) => {
          const e = expected[k] as { p: readonly [string, string]; i: number };
          check(m.oracleOutput === e.p[0], "mismatch oracleOutput");
          check(m.candidateOutput === e.p[1], "mismatch candidateOutput");
          check(JSON.stringify(m.input) === JSON.stringify(runInputs[e.i]), "mismatch input");
          check(typeof m.group === "string" && m.group.length > 0, "mismatch group");
        });
      }),
      { numRuns: 100 },
    );
  });
});

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}
