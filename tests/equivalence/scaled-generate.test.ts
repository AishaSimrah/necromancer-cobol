import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { fieldMaxUnits, formatScaled, parseScaled, pow10 } from "../../src/equivalence/scaled.js";

const PLAIN = /^-?\d+(\.\d+)?$/;

describe("scaled", () => {
  it("formats examples", () => {
    expect(formatScaled(12345n, 2)).toBe("123.45");
    expect(formatScaled(5n, 2)).toBe("0.05");
    expect(formatScaled(-5n, 2)).toBe("-0.05");
    expect(formatScaled(42n, 0)).toBe("42");
    expect(formatScaled(0n, 2)).toBe("0.00");
  });

  it("computes powers and field maxima", () => {
    expect(pow10(3)).toBe(1000n);
    expect(fieldMaxUnits({ name: "p", digits: 7, scale: 2, signed: false })).toBe(999_999_999n);
  });

  it("parseScaled rejects non-plain text and extra decimals", () => {
    expect(parseScaled("1e5", 2)).toBeNull();
    expect(parseScaled(" 1", 2)).toBeNull();
    expect(parseScaled("1.234", 2)).toBeNull();
    expect(parseScaled("-0", 2)).toBe(0n);
    expect(parseScaled("1.5", 2)).toBe(150n);
  });

  // Feature: equivalence-engine, Property 3: format/parse round trip
  it("parseScaled(formatScaled(x, d), d) === x", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }),
        fc.integer({ min: 0, max: 18 }),
        (x, d) => {
          const text = formatScaled(x, d);
          expect(text).toMatch(PLAIN);
          expect(text).not.toBe("-0");
          expect(parseScaled(text, d)).toBe(x);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("generateCases (basic)", () => {
  it("yields one plain line per field, including zero and maximum", () => {
    const cases = generateCases(INTEREST, 20, 1);
    expect(cases).toHaveLength(20);
    expect(cases[0]?.lines).toEqual(["0.00", "0.00", "0"]);
    expect(cases[1]?.lines).toEqual(["9999999.99", "999.99", "99"]);
    for (const c of cases) {
      expect(c.lines).toHaveLength(INTEREST.length);
      for (const l of c.lines) expect(l).toMatch(PLAIN);
    }
  });

  // Feature: equivalence-engine, Property 6 (basic): deterministic for a seed
  it("is deterministic and in range", () => {
    fc.assert(
      fc.property(fc.integer({ min: -2147483648, max: 2147483647 }), fc.integer({ min: 1, max: 50 }), (seed, n) => {
        const a = generateCases(INTEREST, n, seed);
        expect(a).toEqual(generateCases(INTEREST, n, seed));
        expect(a).toHaveLength(n);
        for (const c of a) {
          INTEREST.forEach((f, i) => {
            const u = parseScaled(c.lines[i] ?? "", f.scale);
            expect(u).not.toBeNull();
            expect(u as bigint).toBeLessThanOrEqual(fieldMaxUnits(f));
            expect(u as bigint).toBeGreaterThanOrEqual(0n);
          });
        }
      }),
      { numRuns: 100 },
    );
  });
});
