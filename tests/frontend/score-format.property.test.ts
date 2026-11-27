import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatMatchScore, headlineFor } from "../../src/frontend/core/score-format.js";

const EXPLICIT: readonly number[] = [
  0,
  0.9,
  1,
  1 - Number.EPSILON,
  0.9999999,
  0.99949,
  0.999,
  0.8999999,
];

const scoreArb = fc.oneof(
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.constantFrom(...EXPLICIT),
  fc.integer({ min: 0, max: 1000 }).map((n) => n / 1000),
  fc.integer({ min: 1, max: 60 }).map((k) => 1 - Math.pow(2, -k)),
);

// Feature: necromancer-frontend, Property 4: Match-score formatting never rounds up and is exact only at 1
describe("Property 4: match-score formatting", () => {
  it("never exceeds the true percentage, loses at most 0.1, and is 100.0 only at 1", () => {
    // Validates: Requirements 6.5, 6.6, 12.3
    fc.assert(
      fc.property(scoreArb, (s) => {
        const text = formatMatchScore(s);
        expect(text).toMatch(/^\d{1,3}\.\d$/);
        const parsed = Number.parseFloat(text);
        expect(parsed).toBeLessThanOrEqual(s * 100 + 1e-9);
        expect(parsed).toBeGreaterThanOrEqual(s * 100 - 0.1 - 1e-9);
        if (text === "100.0") expect(s).toBe(1);
        if (s < 1) expect(text).not.toBe("100.0");
      }),
      { numRuns: 500 },
    );
  });

  it("returns 100.0 at exactly 1 and stays below 100.0 just under 1", () => {
    expect(formatMatchScore(1)).toBe("100.0");
    for (const s of [1 - Number.EPSILON, 0.9999999, 0.99949]) {
      expect(formatMatchScore(s)).not.toBe("100.0");
    }
    expect(formatMatchScore(0.99949)).toBe("99.9");
    expect(formatMatchScore(0)).toBe("0.0");
  });
});

// Feature: necromancer-frontend, Property 5: Headline classification matches the fixed score bands
describe("Property 5: headline classification", () => {
  it("maps scores to the fixed bands", () => {
    // Validates: Requirements 6.5, 6.6, 6.7
    fc.assert(
      fc.property(scoreArb, (s) => {
        const h = headlineFor(s);
        if (s === 1) expect(h).toBe("it-lives");
        else if (s >= 0.9) expect(h).toBe("almost-faithful");
        else expect(h).toBe("not-faithful");
        expect(h === "it-lives").toBe(s === 1);
      }),
      { numRuns: 500 },
    );
  });

  it("handles boundaries", () => {
    expect(headlineFor(0)).toBe("not-faithful");
    expect(headlineFor(0.9)).toBe("almost-faithful");
    expect(headlineFor(1 - Number.EPSILON)).toBe("almost-faithful");
    expect(headlineFor(1)).toBe("it-lives");
  });
});
