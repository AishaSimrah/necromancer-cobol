import { Decimal } from "decimal.js";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  display,
  numval,
  roundTo,
  storeUnsigned,
  truncTo,
  wrap,
  zEdit,
  type Dec,
} from "../../src/translator/cobol-runtime.js";

const dec = (text: string): Dec => numval(text);
const s = (value: Dec): string => value.toFixed();

describe("numval", () => {
  it("parses plain decimal text, trimmed", () => {
    expect(s(numval("  1234.56 "))).toBe("1234.56");
    expect(s(numval("-7.5"))).toBe("-7.5");
    expect(s(numval("+3"))).toBe("3");
    expect(s(numval(".5"))).toBe("0.5");
  });

  it("returns 0 for unparseable text", () => {
    for (const text of ["abc", "", "1e5", "1,000", "12 34", "--1", "."]) {
      expect(numval(text).isZero()).toBe(true);
    }
  });
});

describe("truncTo and roundTo", () => {
  it("truncates toward zero and rounds half away from zero at the tie 0.005", () => {
    expect(s(truncTo(dec("0.005"), 2))).toBe("0");
    expect(s(roundTo(dec("0.005"), 2))).toBe("0.01");
    expect(s(roundTo(dec("-0.005"), 2))).toBe("-0.01");
    expect(s(truncTo(dec("-0.019"), 2))).toBe("-0.01");
  });

  it("handles the tie 2.5 at scale 0", () => {
    expect(s(truncTo(dec("2.5"), 0))).toBe("2");
    expect(s(roundTo(dec("2.5"), 0))).toBe("3");
    expect(s(roundTo(dec("3.5"), 0))).toBe("4");
  });

  it("keeps exact values and zero", () => {
    expect(s(roundTo(dec("1050.00"), 2))).toBe("1050");
    expect(s(truncTo(dec("0"), 2))).toBe("0");
  });
});

describe("wrap", () => {
  it("takes the absolute value then drops high-order digits", () => {
    expect(s(wrap(dec("-12345.67"), 3))).toBe("345.67");
    expect(s(wrap(dec("1000"), 3))).toBe("0");
  });
});

describe("storeUnsigned PIC 9(7)V99", () => {
  const store = (text: string): string => s(storeUnsigned(dec(text), 7, 2));

  it("stores zero and max unchanged", () => {
    expect(store("0")).toBe("0");
    expect(store("9999999.99")).toBe("9999999.99");
  });

  it("wraps max plus one unit to zero", () => {
    expect(store("10000000.00")).toBe("0");
    expect(store("10000000.01")).toBe("0.01");
  });

  it("stores the absolute value of a negative input", () => {
    expect(store("-123.45")).toBe("123.45");
  });

  it("truncates extra decimals without rounding", () => {
    expect(store("1.239")).toBe("1.23");
    expect(store("0.999")).toBe("0.99");
    expect(store("-1.239")).toBe("1.23");
  });

  it("drops high-order digits", () => {
    expect(store("123456789.12")).toBe("3456789.12");
  });

  it("stores unparseable text as zero", () => {
    expect(s(storeUnsigned(numval("junk"), 7, 2))).toBe("0");
  });
});

describe("zEdit", () => {
  it("shows zero as spaces plus 0.00", () => {
    expect(zEdit(dec("0"), 7, 2)).toBe("      0.00");
  });

  it("formats example-style values for Z(6)9.99", () => {
    expect(zEdit(dec("1050"), 7, 2)).toBe("   1050.00");
    expect(zEdit(dec("9999999.99"), 7, 2)).toBe("9999999.99");
    expect(zEdit(dec("0.5"), 7, 2)).toBe("      0.50");
  });

  it("has width 10 for Z(6)9.99, 9 for Z(5)9.99 and 7 for Z(7)9", () => {
    expect(zEdit(dec("1"), 7, 2)).toHaveLength(10);
    expect(zEdit(dec("1"), 6, 2)).toHaveLength(9);
    expect(zEdit(dec("1"), 7, 0)).toHaveLength(7);
    expect(zEdit(dec("1"), 7, 0)).toBe("      1");
  });

  it("truncates extra decimals when editing", () => {
    expect(zEdit(dec("1.239"), 7, 2)).toBe("      1.23");
  });
});

describe("display", () => {
  it("joins prefix and edited value with a newline", () => {
    expect(display("TOTAL: ", "      0.00")).toBe("TOTAL:       0.00\n");
  });
});

describe("properties", () => {
  const cfg = { numRuns: 200, seed: 20260101 };

  // Scaled integers keep generated values exact: no JS float is turned into a Decimal.
  const decArb = fc
    .tuple(fc.bigInt({ min: 0n, max: 10n ** 14n }), fc.integer({ min: 0, max: 6 }))
    .map(([n, sc]) => numval(new Decimal(n.toString()).div(new Decimal(10).pow(sc)).toFixed()));

  const signedArb = fc
    .tuple(decArb, fc.boolean())
    .map(([v, neg]) => (neg ? v.neg() : v));

  it("storeUnsigned is in [0, 10^digits) with at most scale decimals", () => {
    fc.assert(
      fc.property(
        signedArb,
        fc.integer({ min: 1, max: 9 }),
        fc.integer({ min: 0, max: 4 }),
        (value, digits, scale) => {
          const out = storeUnsigned(value, digits, scale);
          expect(out.gte(0)).toBe(true);
          expect(out.lt(new Decimal(10).pow(digits))).toBe(true);
          expect(out.decimalPlaces()).toBeLessThanOrEqual(scale);
        },
      ),
      cfg,
    );
  });

  it("zEdit output length is constant for a fixed picture", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 4 }),
        fc.array(fc.bigInt({ min: 0n, max: 10n ** 12n }), { minLength: 2, maxLength: 5 }),
        (intPositions, scale, raws) => {
          const limit = new Decimal(10).pow(intPositions);
          const lengths = raws.map((raw) => {
            const v = new Decimal(raw.toString()).div(new Decimal(10).pow(scale)).mod(limit);
            return zEdit(numval(v.toFixed()), intPositions, scale).length;
          });
          expect(new Set(lengths).size).toBe(1);
        },
      ),
      cfg,
    );
  });

  it("roundTo is within one unit of truncTo for non-negative x", () => {
    fc.assert(
      fc.property(decArb, fc.integer({ min: 0, max: 5 }), (x, scale) => {
        const unit = new Decimal(10).pow(-scale);
        const diff = roundTo(x, scale).minus(truncTo(x, scale));
        expect(diff.gte(0)).toBe(true);
        expect(diff.lte(unit)).toBe(true);
      }),
      cfg,
    );
  });
});
