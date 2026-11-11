import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { compileCobol, isCompiledHandle, releaseHandle, runCompiled, shutdown } from "../../src/oracle/index.js";
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

/** Compile, run once on the given input lines, and always release the handle. */
async function oracleRun(lines: string[]): Promise<{ status: string; stdout: string }> {
  const compiled = await compileCobol(source);
  if (!isCompiledHandle(compiled)) {
    return { status: compiled.status, stdout: compiled.stdout };
  }
  try {
    const result = await runCompiled(compiled, lines, { runTimeoutMs: ORACLE_TIMEOUT_MS });
    return { status: result.status, stdout: result.stdout };
  } finally {
    await releaseHandle(compiled);
  }
}

describe.skipIf(!available)("interest years boundary (real Oracle)", () => {
  afterAll(async () => {
    await shutdown();
  });

  for (const years of ["98", "99"]) {
    it(
      `years = ${years} returns ok and matches the correct Candidate`,
      async () => {
        const lines = ["1000.00", "5.00", years];
        const result = await oracleRun(lines);
        expect(result.status).toBe("ok");
        expect(result.stdout).toBe(correctInterestCandidate(lines));
      },
      LONG,
    );
  }

  it(
    "years = 100 is stored as 00, runs zero iterations and returns the principal",
    async () => {
      const lines = ["1000.00", "5.00", "100"];
      const result = await oracleRun(lines);
      expect(result.status).toBe("ok");
      expect(result.stdout).toBe("BALANCE:    1000.00\n");
      expect(result.stdout).toBe(correctInterestCandidate(lines));
    },
    LONG,
  );
});

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
