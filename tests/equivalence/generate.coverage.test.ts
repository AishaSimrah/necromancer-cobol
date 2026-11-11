import { describe, it } from "vitest";
import fc from "fast-check";
import type { FieldDescriptor } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { fieldMaxUnits, parseScaled } from "../../src/equivalence/scaled.js";

const MAX_EXTRA = 3;
const UNIT = 10n ** BigInt(MAX_EXTRA); // one field unit, expressed at scale + 3 decimals

const fieldSpecArb = fc.record({
  digits: fc.integer({ min: 1, max: 18 }),
  scale: fc.integer({ min: 0, max: 18 }),
  signed: fc.boolean(),
});

/** 1-20 fields with unique names. */
const descriptorsArb: fc.Arbitrary<FieldDescriptor[]> = fc
  .array(fieldSpecArb, { minLength: 1, maxLength: 20 })
  .map((specs) => specs.map((s, i) => ({ name: `f${i}`, ...s })));

function fracLength(text: string): number {
  return text.split(".")[1]?.length ?? 0;
}

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

describe("Property 4: edge coverage", () => {
  // Feature: equivalence-engine, Property 4: Edge coverage in sets of at least 100 vectors
  // **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9**
  it("every field has zero, max, max±1 unit, extra decimals, half-unit and sign coverage", () => {
    fc.assert(
      fc.property(
        descriptorsArb,
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.integer({ min: 100, max: 160 }),
        (fields, seed, count) => {
          const cases = generateCases(fields, count, seed);
          check(cases.length === count, `expected ${count} cases, got ${cases.length}`);

          fields.forEach((f, i) => {
            const vals = cases.map((c) => c.lines[i] ?? "");
            const parsed = vals.map((v) => parseScaled(v, f.scale + MAX_EXTRA));
            check(parsed.every((p) => p !== null), `field ${f.name}: unparsable value`);
            const units = parsed.map((p) => p as bigint);
            const max = fieldMaxUnits(f) * UNIT;

            check(units.includes(0n), `field ${f.name}: no zero`);
            check(units.includes(max), `field ${f.name}: no maximum`);
            check(units.includes(max - UNIT), `field ${f.name}: no maximum minus one unit`);
            check(units.includes(max + UNIT), `field ${f.name}: no maximum plus one unit`);
            check(
              vals.some((v) => fracLength(v) > f.scale && fracLength(v) <= f.scale + MAX_EXTRA),
              `field ${f.name}: no value with 1-3 extra decimals`,
            );
            if (f.scale > 0) {
              check(
                vals.some((v) => fracLength(v) === f.scale + 1 && v.endsWith("5")),
                `field ${f.name}: no half-unit value`,
              );
            }
            if (f.signed) {
              check(units.some((u) => u < 0n), `field ${f.name}: no negative value`);
              check(units.some((u) => u > 0n), `field ${f.name}: no positive value`);
            } else {
              check(vals.some((v) => v.startsWith("-")), `field ${f.name}: no negative value`);
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});
