import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { compileCobol, isCompiledHandle, releaseHandle, shutdown } from "../../src/oracle/index.js";
import { correctInterestCandidate } from "./candidates/interest.js";

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
const LONG = 300_000;

describe.skipIf(!available)("equivalence slice (real Oracle)", () => {
  it(
    "the correct INTEREST candidate matches the COBOL oracle on every case",
    async () => {
      try {
        const report = await runEquivalence({
          source,
          fields: INTEREST,
          candidate: correctInterestCandidate,
          caseCount: 60,
          seed: 7,
        });
        expect(report.mismatches).toEqual([]);
        expect(report.mismatchCount).toBe(0);
        expect(report.matchScore).toBe(1);
      } finally {
        await shutdown();
      }
    },
    LONG,
  );
});
