import { describe, it } from "vitest";
import fc from "fast-check";
import type { FieldDescriptor } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";

const fieldSpecArb = fc.record({
  digits: fc.integer({ min: 1, max: 18 }),
  scale: fc.integer({ min: 0, max: 18 }),
  signed: fc.boolean(),
});

/** 1-20 fields with unique names, at least one unsigned. */
const descriptorsArb: fc.Arbitrary<FieldDescriptor[]> = fc
  .array(fieldSpecArb, { minLength: 1, maxLength: 20 })
  .map((specs) => specs.map((s, i) => ({ name: `f${i}`, ...s })))
  .filter((fields) => fields.some((f) => !f.signed));

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

describe("Property 5: unsigned fields", () => {
  // Feature: equivalence-engine, Property 5: Unsigned fields are non-negative except in a bounded set of vectors
  // **Validates: Requirements 3.9, 3.13**
  it("negative values per unsigned field number between 1 and max(1, floor(10% of cases))", () => {
    fc.assert(
      fc.property(
        descriptorsArb,
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.integer({ min: 100, max: 150 }),
        (fields, seed, count) => {
          const cases = generateCases(fields, count, seed);
          check(cases.length === count, `expected ${count} cases, got ${cases.length}`);
          const budget = Math.max(1, Math.floor(0.1 * count));

          fields.forEach((f, i) => {
            if (f.signed) return;
            const negatives = cases.filter((c) => (c.lines[i] ?? "").startsWith("-")).length;
            check(negatives >= 1, `field ${f.name}: no negative vector`);
            check(
              negatives <= budget,
              `field ${f.name}: ${negatives} negative vectors exceeds budget ${budget}`,
            );
            // A minus sign may only appear as the leading character.
            for (const c of cases) {
              const v = c.lines[i] ?? "";
              check(!v.slice(1).includes("-"), `field ${f.name}: malformed "${v}"`);
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
