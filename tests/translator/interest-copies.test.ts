// The translator copies of the INTEREST candidates must match the originals in
// tests/equivalence/candidates/interest.ts on a fixed set of 200 vectors. No Oracle.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SAMPLE_DATA } from "../../src/translator/sample-data.js";
import { candidate as correctCopy } from "../../src/translator/translations/interest.correct.js";
import { candidate as naiveCopy } from "../../src/translator/translations/interest.naive.js";
import {
  correctInterestCandidate,
  naiveInterestCandidate,
} from "../equivalence/candidates/interest.js";

type Vector = readonly string[];

const TOTAL = 200;
const SEED = 20260101;

const examples: Vector[] = SAMPLE_DATA.interest.examples.map((pair) => [...pair.input]);

const boundary: Vector[] = [
  ["0", "0", "0"],
  ["0.00", "5.00", "10"],
  ["9999999.99", "0", "1"],
  ["9999999.99", "5.00", "1"],
  ["9999999.99", "999.99", "99"],
  ["10000000.00", "5.00", "1"],
  ["10000000.01", "5.00", "1"],
  ["1234567890", "5.00", "3"],
  ["9999999999", "1.00", "2"],
  ["1000.00", "5.005", "1"],
  ["1000.00", "5.015", "2"],
  ["1000.00", "0.005", "10"],
  ["1000.00", "999.995", "3"],
  ["1000.00", "1000.00", "2"],
  ["1000.00", "12.345", "5"],
  ["0.01", "50.00", "1"],
  ["0.01", "0.01", "99"],
  ["100.00", "10.00", "0"],
  ["100.00", "10.00", "1"],
  ["100.00", "10.00", "98"],
  ["100.00", "10.00", "99"],
  ["100.00", "10.00", "100"],
  ["100.00", "10.00", "101"],
  ["100.00", "10.00", "199"],
  ["100.00", "0", "99"],
  ["-100.00", "5.00", "2"],
  ["-0.01", "5.00", "1"],
  ["-9999999.99", "5.00", "1"],
  ["1000.00", "-5.00", "2"],
  ["1000.00", "5.00", "-3"],
  ["1000.999", "5.00", "2"],
  ["1000.005", "5.00", "1"],
  ["0.005", "5.00", "1"],
  ["", "", ""],
  ["abc", "5.00", "2"],
  ["1000.00", "5.00", "abc"],
  ["  1000.00 ", " 5.00 ", " 2 "],
  ["1000", "5", "2"],
  ["1500000.00", "3.50", "30"],
  ["250000.50", "7.25", "12"],
];

const decimalText = (maxInt: number, maxFrac: number): fc.Arbitrary<string> =>
  fc
    .tuple(
      fc.boolean(),
      fc.integer({ min: 0, max: 10 ** maxInt - 1 }),
      fc.integer({ min: 0, max: 10 ** maxFrac - 1 }),
      fc.integer({ min: 0, max: maxFrac }),
    )
    .map(([neg, int, frac, fracDigits]) => {
      const fracText = fracDigits === 0 ? "" : `.${String(frac).padStart(maxFrac, "0").slice(0, fracDigits)}`;
      return `${neg && int % 7 === 0 ? "-" : ""}${int}${fracText}`;
    });

const vectorArb: fc.Arbitrary<Vector> = fc.tuple(
  decimalText(9, 3),
  decimalText(4, 3),
  fc.integer({ min: 0, max: 120 }).map(String),
);

function buildVectors(): Vector[] {
  const fixed = [...examples, ...boundary];
  const numRuns = TOTAL - fixed.length;
  return [...fixed, ...fc.sample(vectorArb, { seed: SEED, numRuns })];
}

const vectors = buildVectors();

/** Both copies are synchronous; a Promise here would be a bug in the copy. */
function sync(value: string | Promise<string>): string {
  if (typeof value !== "string") throw new Error("candidate returned a Promise");
  return value;
}

function describeMismatch(v: Vector, original: string, copy: string): string {
  return `input=${JSON.stringify(v)} original=${JSON.stringify(original)} copy=${JSON.stringify(copy)}`;
}

describe("interest translation copies match the originals", () => {
  it("uses exactly 200 vectors, identical on every run", () => {
    expect(vectors).toHaveLength(TOTAL);
    expect(buildVectors()).toEqual(vectors);
  });

  it("correct copy equals correctInterestCandidate on every vector", () => {
    for (const v of vectors) {
      const original = correctInterestCandidate([...v]);
      const copy = sync(correctCopy([...v]));
      expect(copy, describeMismatch(v, original, copy)).toBe(original);
    }
  });

  it("naive copy equals naiveInterestCandidate on every vector", () => {
    for (const v of vectors) {
      const original = naiveInterestCandidate([...v]);
      const copy = sync(naiveCopy([...v]));
      expect(copy, describeMismatch(v, original, copy)).toBe(original);
    }
  });
});
