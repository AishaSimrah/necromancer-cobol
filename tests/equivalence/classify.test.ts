import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Decimal } from "decimal.js";
import { classifyVector, GROUP_ORDER, type EvidenceGroup } from "../../src/equivalence/classify.js";
import { INTEREST, PAYROLL, type FieldDescriptor } from "../../src/equivalence/descriptors.js";
import { formatScaled } from "../../src/equivalence/scaled.js";

describe("classifyVector examples", () => {
  it("orders the groups by precedence", () => {
    expect(GROUP_ORDER[0]).toBe("field overflow behavior");
    expect(GROUP_ORDER[3]).toBe("standard computation");
  });
  it("classifies a plain in-range vector as standard", () => {
    expect(classifyVector(INTEREST, ["1000.00", "5.00", "3"])).toBe("standard computation");
  });
  it("classifies zero and the field maximum as boundaries", () => {
    expect(classifyVector(INTEREST, ["0.00", "5.00", "3"])).toBe("zero and maximum boundaries");
    expect(classifyVector(INTEREST, ["9999999.99", "5.00", "3"])).toBe("zero and maximum boundaries");
  });
  it("classifies 0.005 at scale 2 as half-unit", () => {
    expect(classifyVector(INTEREST, ["0.005", "5.00", "3"])).toBe("half-unit rounding boundary");
  });
  it("does not treat 0.0051 or 0.0050 trailing digits wrongly", () => {
    expect(classifyVector(INTEREST, ["1.0051", "5.00", "3"])).toBe("standard computation");
    expect(classifyVector(INTEREST, ["1.0050", "5.00", "3"])).toBe("half-unit rounding boundary");
  });
  it("classifies above-max and extra integer digits as overflow", () => {
    expect(classifyVector(INTEREST, ["10000000.00", "5.00", "3"])).toBe("field overflow behavior");
    expect(classifyVector(INTEREST, ["1000.00", "5.00", "100"])).toBe("field overflow behavior");
  });
  it("treats a negative unsigned field as overflow but -0 as not negative", () => {
    expect(classifyVector(PAYROLL, ["-1.0", "5.00"])).toBe("field overflow behavior");
    expect(classifyVector(PAYROLL, ["-0", "5.00"])).toBe("zero and maximum boundaries");
  });
  it("gives overflow precedence over half-unit and boundary", () => {
    expect(classifyVector(INTEREST, ["0.005", "-1.00", "0"])).toBe("field overflow behavior");
    expect(classifyVector(INTEREST, ["0.005", "0.00", "3"])).toBe("half-unit rounding boundary");
  });
});

/** Independent reference using Decimal and string digits rather than the module's arithmetic. */
function reference(fields: readonly FieldDescriptor[], lines: readonly string[]): EvidenceGroup {
  const vals = lines.map((l) => new Decimal(l));
  const overflow = fields.some((f, i) => {
    const v = vals[i] as Decimal;
    const max = new Decimal(`${"9".repeat(f.digits)}${f.scale > 0 ? "." + "9".repeat(f.scale) : ""}`);
    return v.abs().greaterThan(max) || (!f.signed && v.lessThan(0));
  });
  if (overflow) return "field overflow behavior";
  const half = fields.some((f, i) => {
    const frac = (vals[i] as Decimal).abs().toFixed().split(".")[1] ?? "";
    const tail = frac.slice(f.scale);
    return /^50*$/.test(tail);
  });
  if (half) return "half-unit rounding boundary";
  const edge = fields.some((f, i) => {
    const v = vals[i] as Decimal;
    const max = new Decimal(`${"9".repeat(f.digits)}${f.scale > 0 ? "." + "9".repeat(f.scale) : ""}`);
    return v.isZero() || v.equals(max);
  });
  return edge ? "zero and maximum boundaries" : "standard computation";
}

const fieldArb: fc.Arbitrary<FieldDescriptor> = fc.record({
  name: fc.constant("f"),
  digits: fc.integer({ min: 1, max: 6 }),
  scale: fc.integer({ min: 0, max: 4 }),
  signed: fc.boolean(),
});

describe("classifyVector property", () => {
  // Feature: equivalence-engine, Property 7: Classification matches an independent specification and is total
  // **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
  it("matches the independent reference and is total", () => {
    const caseArb = fc
      .array(fieldArb, { minLength: 1, maxLength: 4 })
      .chain((fields) =>
        fc
          .tuple(
            ...fields.map((f) =>
              fc.tuple(
                fc.bigInt({ min: -(10n ** BigInt(f.digits + f.scale + 1)), max: 10n ** BigInt(f.digits + f.scale + 1) }),
                fc.integer({ min: 0, max: 2 }),
              ),
            ),
          )
          .map((parts) => ({
            fields,
            lines: parts.map(([units, extra], i) => {
              const f = fields[i] as FieldDescriptor;
              // extra fractional digits let half-unit values like x.xx5 appear
              return formatScaled(units * 10n ** BigInt(extra), f.scale + extra);
            }),
          })),
      );
    fc.assert(
      fc.property(caseArb, ({ fields, lines }) => {
        const got = classifyVector(fields, lines);
        expect(GROUP_ORDER).toContain(got);
        expect(got).toBe(reference(fields, lines));
      }),
      { numRuns: 500 },
    );
  });
});
