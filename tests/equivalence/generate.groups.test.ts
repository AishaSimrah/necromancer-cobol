import { describe, it } from "vitest";
import fc from "fast-check";
import { GROUP_ORDER } from "../../src/equivalence/classify.js";
import type { FieldDescriptor } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";

const fieldSpecArb = fc.record({
  digits: fc.integer({ min: 1, max: 18 }),
  scale: fc.integer({ min: 0, max: 18 }),
  signed: fc.boolean(),
});

/** 1-20 fields with unique names. */
const descriptorsArb: fc.Arbitrary<FieldDescriptor[]> = fc
  .array(fieldSpecArb, { minLength: 1, maxLength: 20 })
  .map((specs) => specs.map((s, i) => ({ name: `f${i}`, ...s })));

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

describe("Property 8: group quotas and construction", () => {
  // Feature: equivalence-engine, Property 8: Group quotas and construction agree with classification
  // **Validates: Requirements 4.7**
  it("each group meets its 10% quota and random cases classify into their construction target", () => {
    fc.assert(
      fc.property(
        descriptorsArb,
        fc.integer({ min: -2147483648, max: 2147483647 }),
        fc.integer({ min: 40, max: 200 }),
        (fields, seed, count) => {
          const cases = generateCases(fields, count, seed);
          check(cases.length === count, `expected ${count} cases, got ${cases.length}`);

          const quota = Math.floor(count * 0.1);
          for (const group of GROUP_ORDER) {
            const n = cases.filter((c) => c.group === group).length;
            check(n >= quota, `group "${group}" got ${n}, quota ${quota}`);
          }

          for (const c of cases) {
            if (c.target === undefined) continue;
            check(
              c.group === c.target,
              `case ${c.index} built for "${c.target}" classified "${c.group}": ${c.lines.join(",")}`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);

  it("marks only edge-corpus vectors without a target", () => {
    const fields: FieldDescriptor[] = [{ name: "a", digits: 7, scale: 2, signed: false }];
    const cases = generateCases(fields, 40, 1);
    check(cases.slice(0, 8).every((c) => c.target === undefined), "corpus has target");
    check(cases.slice(8).every((c) => c.target !== undefined), "random case lacks target");
  });
});
