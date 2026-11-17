import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Candidate } from "../../src/equivalence/compare.js";
import { candidate as interestCorrect } from "../../src/translator/translations/interest.correct.js";
import { candidate as interestNaive } from "../../src/translator/translations/interest.naive.js";
import { candidate as interestSubtle } from "../../src/translator/translations/interest.subtle.js";
import { candidate as payrollCorrect } from "../../src/translator/translations/payroll.correct.js";
import { candidate as payrollNaive } from "../../src/translator/translations/payroll.naive.js";
import { candidate as payrollSubtle } from "../../src/translator/translations/payroll.subtle.js";
import { candidate as taxCorrect } from "../../src/translator/translations/tax.correct.js";
import { candidate as taxNaive } from "../../src/translator/translations/tax.naive.js";
import { candidate as taxSubtle } from "../../src/translator/translations/tax.subtle.js";

const RUNS = { numRuns: 200, seed: 20260101 } as const;

/** Plain decimal text: optional minus, integer digits, optional decimals. */
function decimalText(opts: {
  readonly minus: boolean;
  readonly minInt: number;
  readonly maxInt: number;
  readonly maxFrac: number;
}): fc.Arbitrary<string> {
  return fc
    .tuple(
      opts.minus ? fc.boolean() : fc.constant(false),
      fc.stringMatching(new RegExp(`^[0-9]{${opts.minInt},${opts.maxInt}}$`)),
      fc.stringMatching(new RegExp(`^[0-9]{0,${opts.maxFrac}}$`)),
    )
    .map(([neg, int, frac]) => `${neg ? "-" : ""}${int}${frac === "" ? "" : `.${frac}`}`);
}

const anyNum = decimalText({ minus: true, minInt: 1, maxInt: 12, maxFrac: 6 });
const plainNum = decimalText({ minus: false, minInt: 1, maxInt: 12, maxFrac: 6 });

interface Sample {
  readonly name: string;
  readonly output: RegExp;
  readonly vector: fc.Arbitrary<string[]>;
  readonly safeVector: fc.Arbitrary<string[]>;
  readonly correct: Candidate;
  readonly subtle: Candidate;
  readonly naive: Candidate;
  readonly subtleWitness: readonly string[];
  readonly naiveWitness: readonly string[];
}

const SAMPLES: readonly Sample[] = [
  {
    name: "interest",
    output: /^BALANCE: [ 0-9]{6}\d\.\d\d\n$/,
    vector: fc.tuple(anyNum, anyNum, anyNum).map((t) => [...t]),
    // Trap: interest-years-pic99. Subtle skips mod 100 on years, so keep years below 100 in magnitude.
    safeVector: fc
      .tuple(anyNum, anyNum, decimalText({ minus: true, minInt: 1, maxInt: 2, maxFrac: 4 }))
      .map((t) => [...t]),
    correct: interestCorrect,
    subtle: interestSubtle,
    naive: interestNaive,
    subtleWitness: ["1000", "5", "100"], // correct: 0 years, subtle: 100 years
    naiveWitness: ["9000000", "50", "3"], // correct wraps at 7 digits, naive does not
  },
  {
    name: "payroll",
    output: /^GROSS: [ 0-9]{5}\d\.\d\d\nDEDUCT: [ 0-9]{5}\d\.\d\d\nNET: [ 0-9]{5}\d\.\d\d\n$/,
    vector: fc.tuple(anyNum, anyNum).map((t) => [...t]),
    // Trap: payroll-hours-pic. Subtle stores hours in 9(4)V9, so keep hours below 1000 in magnitude.
    safeVector: fc
      .tuple(decimalText({ minus: true, minInt: 1, maxInt: 3, maxFrac: 4 }), anyNum)
      .map((t) => [...t]),
    correct: payrollCorrect,
    subtle: payrollSubtle,
    naive: payrollNaive,
    subtleWitness: ["1000", "10"], // correct: hours wrap to 0, subtle: 1000 hours
    naiveWitness: ["999.9", "999.99"], // gross overflows 6 digits; naive does not wrap
  },
  {
    name: "tax",
    output: /^TAX: [ 0-9]{7}\d\n$/,
    vector: fc.tuple(anyNum).map((t) => [...t]),
    // Trap: tax-unsigned-income. Subtle keeps the sign of a negative income, so use non-negative text only.
    safeVector: fc.tuple(plainNum).map((t) => [...t]),
    correct: taxCorrect,
    subtle: taxSubtle,
    naive: taxNaive,
    subtleWitness: ["-300000"], // correct: income 300000 -> 2500, subtle: negative income -> 0
    naiveWitness: ["750000"], // correct: 62500, naive: flat 20% -> 150000
  },
];

describe("translation properties (no Oracle)", () => {
  for (const s of SAMPLES) {
    describe(s.name, () => {
      // Feature: sample-catalog, Property 1: correct translation never throws and output has the sample's shape
      it("Property 1: correct output has the expected shape", () => {
        fc.assert(
          fc.property(s.vector, (v) => {
            expect(s.correct(v)).toMatch(s.output);
          }),
          RUNS,
        );
      });

      // Feature: sample-catalog, Property 2: correct translation is deterministic
      it("Property 2: two calls give the same string", () => {
        fc.assert(
          fc.property(s.vector, (v) => {
            expect(s.correct(v)).toBe(s.correct(v));
          }),
          RUNS,
        );
      });

      // Feature: sample-catalog, Property 3: subtle agrees with correct outside its trap
      it("Property 3: subtle equals correct on the safe domain", () => {
        fc.assert(
          fc.property(s.safeVector, (v) => {
            expect(s.subtle(v)).toBe(s.correct(v));
          }),
          RUNS,
        );
      });

      // Feature: sample-catalog, Property 4: subtle differs from correct inside its trap (fixed witness)
      it("Example 4: subtle differs from correct on the witness", () => {
        expect(s.subtle([...s.subtleWitness])).not.toBe(s.correct([...s.subtleWitness]));
      });

      // Feature: sample-catalog, Property 5: naive is not exact (fixed witness)
      it("Example 5: naive differs from correct on the witness", () => {
        expect(s.naive([...s.naiveWitness])).not.toBe(s.correct([...s.naiveWitness]));
      });
    });
  }
});
