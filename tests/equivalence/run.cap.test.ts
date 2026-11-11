import { describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { generateCases } from "../../src/equivalence/generate.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

const CASE_COUNT = 120;
const SEED = 20240607;
const ORACLE_OUTPUT = "ORACLE";

/** Deterministic mismatch rule: the Candidate disagrees when the joined input has even length. */
function disagrees(lines: readonly string[]): boolean {
  return lines.join("|").length % 2 === 0;
}

function candidate(lines: string[]): string {
  return disagrees(lines) ? "CANDIDATE" : ORACLE_OUTPUT;
}

async function runWithCap(cap: number) {
  const oracle = createFakeOracle({ run: okResult(ORACLE_OUTPUT) });
  return runEquivalence({
    source: "IDENTIFICATION DIVISION.",
    fields: INTEREST,
    candidate,
    caseCount: CASE_COUNT,
    seed: SEED,
    mismatchListCap: cap,
    oracle,
  });
}

/** Independent expectation, computed from the generated cases alone. */
function expectedMismatchInputs(): string[][] {
  return generateCases(INTEREST, CASE_COUNT, SEED)
    .filter((c) => disagrees(c.lines))
    .map((c) => [...c.lines]);
}

describe("mismatch list cap", () => {
  // Validates: Requirements 7.5, 7.11, 12.9
  it("keeps the first `cap` mismatches in execution order with an exact total", async () => {
    const cap = 3;
    const expected = expectedMismatchInputs();
    expect(expected.length).toBeGreaterThan(cap);

    const report = await runWithCap(cap);

    expect(report.seed).toBe(SEED);
    expect(report.mismatchCount).toBe(expected.length);
    expect(report.mismatches.length).toBe(cap);
    expect(report.mismatchListTruncated).toBe(true);
    expect(report.mismatches.map((m) => [...m.input])).toEqual(expected.slice(0, cap));
    for (const m of report.mismatches) {
      expect(m.oracleOutput).toBe(ORACLE_OUTPUT);
      expect(m.candidateOutput).toBe("CANDIDATE");
    }
    expect(report.matchedCount + report.mismatchCount).toBe(report.conclusiveCount);
  });

  it("is not truncated when the cap equals mismatchCount", async () => {
    const expected = expectedMismatchInputs();
    const report = await runWithCap(expected.length);

    expect(report.mismatchCount).toBe(expected.length);
    expect(report.mismatches.length).toBe(expected.length);
    expect(report.mismatchListTruncated).toBe(false);
    expect(report.mismatches.map((m) => [...m.input])).toEqual(expected);
  });

  it("is not truncated when the cap exceeds mismatchCount", async () => {
    const expected = expectedMismatchInputs();
    const report = await runWithCap(expected.length + 50);

    expect(report.mismatchCount).toBe(expected.length);
    expect(report.mismatches.length).toBe(expected.length);
    expect(report.mismatchListTruncated).toBe(false);
  });
});
