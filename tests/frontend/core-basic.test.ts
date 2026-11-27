import { describe, expect, it } from "vitest";
import { formatMatchScore, headlineFor, perfectScoreLine } from "../../src/frontend/core/score-format.js";
import { ritualGhostCount, ritualSpeedStep, verdictGhostCount } from "../../src/frontend/core/ghost-count.js";
import { ROW_RISE_LIMIT, rowRiseClass } from "../../src/frontend/core/row-rise.js";

describe("score-format", () => {
  it("formats without rounding up to 100", () => {
    expect(formatMatchScore(1)).toBe("100.0");
    expect(formatMatchScore(0.9999)).toBe("99.9");
    expect(formatMatchScore(0.997)).toBe("99.7");
    expect(formatMatchScore(0)).toBe("0.0");
    expect(formatMatchScore(-1)).toBe("0.0");
    expect(formatMatchScore(2)).toBe("100.0");
  });
  it("picks headlines", () => {
    expect(headlineFor(1)).toBe("it-lives");
    expect(headlineFor(0.9)).toBe("almost-faithful");
    expect(headlineFor(0.89)).toBe("not-faithful");
  });
  it("builds the perfect line", () => {
    expect(perfectScoreLine(5)).toBe("No mismatches in 5 conclusive cases.");
  });
});

describe("ghost-count", () => {
  it("bounds ghosts and steps", () => {
    expect(ritualGhostCount(0, 0)).toBe(2);
    expect(ritualGhostCount(10, 10)).toBe(12);
    expect(ritualGhostCount(99, 10)).toBe(12);
    expect(ritualSpeedStep(0, 100)).toBe(1);
    expect(ritualSpeedStep(25, 100)).toBe(2);
    expect(ritualSpeedStep(50, 100)).toBe(3);
    expect(ritualSpeedStep(75, 100)).toBe(4);
  });
  it("verdict ghosts", () => {
    expect(verdictGhostCount(0, 0, 1)).toBe(0);
    expect(verdictGhostCount(50, 30, 0.5)).toBe(20);
    expect(verdictGhostCount(3, 3, 0.9)).toBe(3);
  });
});

describe("row-rise", () => {
  it("returns classes only below the limit", () => {
    expect(rowRiseClass(0)).toBe("row-rise row-rise-0");
    expect(rowRiseClass(ROW_RISE_LIMIT - 1)).toBe("row-rise row-rise-19");
    expect(rowRiseClass(ROW_RISE_LIMIT)).toBeUndefined();
    expect(rowRiseClass(-1)).toBeUndefined();
    expect(rowRiseClass(1.5)).toBeUndefined();
  });
});
