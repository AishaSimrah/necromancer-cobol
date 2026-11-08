/**
 * Spike: shrinking from a known failing example (equivalence-engine task 1.1).
 *
 * Installed fast-check: 4.10.2.
 *
 * Finding: PRIMARY approach is supported. `fc.check(property, { examples: [[start]],
 * numRuns: 1, endOnFailure: false })` runs the example first, and when it fails
 * fast-check shrinks it (the reported counterexample is smaller than `start`).
 * The greedy `arb.shrink(value, undefined)` loop is also supported and is kept as
 * the fallback.
 *
 * Decision for task 9.1: `shrink.ts` uses the `examples` + `fc.check` approach.
 *
 * Requirements: 8.1, 8.3, 8.5
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

type Pair = [bigint, bigint];

const THRESHOLD = 1000n;
const MAX = 10n ** 9n;
const pairArb = fc.tuple(fc.bigInt({ min: 0n, max: MAX }), fc.bigInt({ min: 0n, max: MAX }));
const fails = (p: Pair): boolean => p[0] > THRESHOLD;
const size = (p: Pair): bigint => p[0] + p[1];

describe("fast-check shrink spike", () => {
  it("shrinks an `examples` entry via fc.check", async () => {
    const start: Pair = [900_000_000n, 800_000_000n];
    const result = await fc.check(
      fc.asyncProperty(pairArb, async (p) => !fails(p)),
      { examples: [[start]], seed: 42, numRuns: 1, endOnFailure: false },
    );
    expect(result.failed).toBe(true);
    const ce = result.counterexample;
    expect(ce).not.toBeNull();
    const shrunk = (ce as [Pair])[0];
    expect(fails(shrunk)).toBe(true);
    expect(size(shrunk)).toBeLessThan(size(start));
    expect(result.numShrinks).toBeGreaterThan(0);
  });

  it("fallback: greedy loop over arb.shrink with a call limit", () => {
    const start: Pair = [900_000_000n, 800_000_000n];
    const limit = 200;
    let current = start;
    let calls = 0;
    let progressed = true;
    while (progressed && calls < limit) {
      progressed = false;
      const candidates = pairArb.shrink(current, undefined);
      for (const c of candidates) {
        if (calls >= limit) break;
        calls++;
        if (fails(c.value)) {
          current = c.value;
          progressed = true;
          break;
        }
      }
    }
    expect(calls).toBeLessThanOrEqual(limit);
    expect(fails(current)).toBe(true);
    expect(size(current)).toBeLessThan(size(start));
  });
});
