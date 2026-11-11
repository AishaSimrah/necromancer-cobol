import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { compileCobol, isCompiledHandle, releaseHandle, shutdown } from "../../src/oracle/index.js";
import { correctInterestCandidate, naiveInterestCandidate } from "./candidates/interest.js";

const source = readFileSync(resolve(process.cwd(), "cobol-samples", "interest.cbl"), "utf8");

/** Probe once whether the real Oracle can compile; skip the suite when it cannot. */
async function probeOracle(): Promise<boolean> {
  try {
    const result = await compileCobol(source);
    if (isCompiledHandle(result)) {
      await releaseHandle(result);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const available = await probeOracle();
const LONG = 600_000;
const ORACLE_TIMEOUT_MS = 10_000;

describe.skipIf(!available)("interest equivalence (real Oracle)", () => {
  it(
    "the correct Candidate matches on every case with the default Case_Count",
    async () => {
      try {
        const report = await runEquivalence({
          source,
          fields: INTEREST,
          candidate: correctInterestCandidate,
          seed: 11,
          oracleTimeoutMs: ORACLE_TIMEOUT_MS,
        });
        expect(report.mismatches).toEqual([]);
        expect(report.matchScore).toBe(1);
      } finally {
        await shutdown();
      }
    },
    LONG,
  );

  it(
    "the naive Candidate is caught with one Shrunk_Example per mismatching group",
    async () => {
      try {
        const report = await runEquivalence({
          source,
          fields: INTEREST,
          candidate: naiveInterestCandidate,
          caseCount: 300,
          seed: 11,
          oracleTimeoutMs: ORACLE_TIMEOUT_MS,
        });
        expect(report.mismatchCount).toBeGreaterThanOrEqual(1);
        expect(report.matchScore).toBeDefined();
        expect(report.matchScore ?? 1).toBeGreaterThanOrEqual(0);
        expect(report.matchScore ?? 1).toBeLessThan(1);

        const mismatchGroups = report.groups
          .filter((g) => g.conclusive - g.matched > 0)
          .map((g) => g.group);
        const shrunkGroups = report.shrunkExamples.map((s) => s.group);
        expect([...shrunkGroups].sort()).toEqual([...mismatchGroups].sort());
        expect(new Set(shrunkGroups).size).toBe(shrunkGroups.length);
        for (const s of report.shrunkExamples) {
          expect(s.input.length).toBe(INTEREST.length);
          expect(s.oracleOutput).not.toBe(s.candidateOutput);
        }
      } finally {
        await shutdown();
      }
    },
    LONG,
  );
});
