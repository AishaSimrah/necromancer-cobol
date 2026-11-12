import { describe, expect, it } from "vitest";
import { INTEREST, PAYROLL, TAX } from "../../src/equivalence/descriptors.js";
import { SAMPLE_DATA } from "../../src/translator/sample-data.js";

describe("sample-data does not touch the descriptor arrays", () => {
  it("leaves INTEREST, PAYROLL and TAX unfrozen, including their descriptors", () => {
    for (const original of [INTEREST, PAYROLL, TAX]) {
      expect(Object.isFrozen(original)).toBe(false);
      for (const field of original) {
        expect(Object.isFrozen(field)).toBe(false);
      }
    }
  });

  it("freezes equal copies in SAMPLE_DATA", () => {
    const pairs = [
      [SAMPLE_DATA.interest.fields, INTEREST],
      [SAMPLE_DATA.payroll.fields, PAYROLL],
      [SAMPLE_DATA.tax.fields, TAX],
    ] as const;
    for (const [copy, original] of pairs) {
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
      expect(Object.isFrozen(copy)).toBe(true);
      copy.forEach((field, i) => {
        expect(field).not.toBe(original[i]);
        expect(Object.isFrozen(field)).toBe(true);
      });
    }
  });
});
