import { describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";

const SOURCE = "IDENTIFICATION DIVISION.";
const CASES = 100;
const SEED = 7;

describe("runEquivalence with a fake Oracle", () => {
  // Requirements 6.2, 6.5
  it("excludes inconclusive cases from the score denominator", async () => {
    const oracle = createFakeOracle({
      run: ({ callIndex }) => (callIndex % 2 === 0 ? okResult("x") : failResult("timeout", "slow")),
    });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(report.casesRun).toBe(CASES);
    expect(report.inconclusiveCount).toBe(CASES / 2);
    expect(report.conclusiveCount).toBe(CASES / 2);
    expect(report.matchScore).toBe(1);
    expect(report.containsInconclusive).toBe(true);
    expect(report.outcome).toBe("completed");
  });

  // Requirement 2.4
  it("releases the handle exactly once when the Candidate fails", async () => {
    const oracle = createFakeOracle({ run: okResult("x") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => {
        throw new Error("candidate boom");
      },
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(oracle.releaseCalls).toBe(1);
    expect(oracle.liveHandleIds).toEqual([]);
    expect(report.mismatchCount).toBe(CASES);
  });

  // Requirements 2.3, 2.5
  it("releases exactly once on Oracle error and does not mask it when release also throws", async () => {
    const runtimeError = new Error("oracle runtime failure");
    const oracle = createFakeOracle({
      run: okResult("x"),
      throwOnRun: { error: runtimeError, when: (i) => i === 3 },
      throwOnRelease: new Error("release failure"),
    });
    await expect(
      runEquivalence({
        source: SOURCE,
        fields: INTEREST,
        candidate: () => "x",
        caseCount: CASES,
        seed: SEED,
        oracle,
      }),
    ).rejects.toBe(runtimeError);
    expect(oracle.releaseCalls).toBe(1);
    expect(oracle.runCalls).toBe(4);
  });

  // Requirement 2.6
  it("reports oracle_unavailable without a score on compile error, with 0 releases", async () => {
    const oracle = createFakeOracle({ compileResult: failResult("compile_error", "bad source") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(report.outcome).toBe("oracle_unavailable");
    expect(report.matchScore).toBeUndefined();
    expect(report.oracleStatus).toBe("compile_error");
    expect(oracle.releaseCalls).toBe(0);
    expect(oracle.runCalls).toBe(0);
  });

  // Requirement 11.6
  it("reports inconclusive without a score when no case is conclusive", async () => {
    const oracle = createFakeOracle({ run: failResult("timeout", "slow") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(report.outcome).toBe("inconclusive");
    expect(report.matchScore).toBeUndefined();
    expect(report.conclusiveCount).toBe(0);
    expect(report.inconclusiveCount).toBe(CASES);
    expect(oracle.releaseCalls).toBe(1);
  });

  // Requirement 12.9
  it("awaits an async Candidate that resolves and compares its value", async () => {
    const oracle = createFakeOracle({ run: okResult("async-out") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        return "async-out";
      },
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(report.matchedCount).toBe(CASES);
    expect(report.mismatchCount).toBe(0);
    expect(report.matchScore).toBe(1);
  });

  // Requirements 12.9, 2.4
  it("records a Mismatch with the rejection message when an async Candidate rejects", async () => {
    const oracle = createFakeOracle({ run: okResult("x") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => Promise.reject(new Error("async rejection")),
      caseCount: CASES,
      seed: SEED,
      oracle,
    });
    expect(report.mismatchCount).toBe(CASES);
    expect(report.mismatches[0]?.candidateOutput).toBe("async rejection");
    expect(report.mismatches[0]?.oracleOutput).toBe("x");
    expect(oracle.releaseCalls).toBe(1);
  });
});
