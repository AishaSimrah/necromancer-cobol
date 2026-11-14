import { describe, expect, it } from "vitest";
import { candidate } from "../../src/translator/translations/interest.correct.js";

// Pairs documented in cobol-samples/EXPECTED.md (interest.cbl).
const PAIRS: ReadonlyArray<readonly [readonly string[], string]> = [
  [["1000", "5", "3"], "BALANCE:    1157.63\n"],
  [["1234.56", "7.25", "10"], "BALANCE:    2485.95\n"],
  [["9000000", "50", "3"], "BALANCE: 7875000.00\n"],
];

describe("interest.correct candidate (no Oracle)", () => {
  for (const [inputs, expected] of PAIRS) {
    it(`gives the documented output for ${inputs.join(" / ")}`, () => {
      expect(candidate([...inputs])).toBe(expected);
    });
  }
});
