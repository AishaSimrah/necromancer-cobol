import { describe, expect, it } from "vitest";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

const SOURCE = "IDENTIFICATION DIVISION.";

describe("Time_Budget stop", () => {
  // **Validates: Requirements 9.5, 9.12**
  it("stops within the budget plus 1000 ms, sets budgetReached and counts completed cases", async () => {
    let clock = 0;
    const oracle = createFakeOracle({
      run: () => {
        clock += 100; // each Oracle run costs 100 ms on the injected clock
        return okResult("x");
      },
    });
    const budget = 250;
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: 100,
      seed: 1,
      timeBudgetMs: budget,
      oracle,
      now: () => clock,
    });

    expect(report.budgetReached).toBe(true);
    expect(report.aborted).toBe(false);
    // Runs at clock 0, 100, 200; at 300 the budget is reached.
    expect(report.casesRun).toBe(3);
    expect(oracle.runCalls).toBe(report.casesRun);
    expect(report.elapsedMs).toBeLessThanOrEqual(budget + 1000);
    expect(oracle.releaseCalls).toBe(1);
  });

  it("does not set budgetReached when the run finishes inside the budget", async () => {
    const oracle = createFakeOracle({ run: okResult("x") });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: 20,
      seed: 1,
      timeBudgetMs: 1000,
      oracle,
      now: () => 0,
    });
    expect(report.budgetReached).toBe(false);
    expect(report.casesRun).toBe(oracle.runCalls);
    expect(oracle.releaseCalls).toBe(1);
  });
});

describe("Pre-aborted signal", () => {
  // **Validates: Requirements 7.7, 9.13, 11.6**
  it("makes 0 Oracle calls and reports aborted with casesRun 0 and outcome inconclusive", async () => {
    const oracle = createFakeOracle({ run: okResult("x") });
    const controller = new AbortController();
    controller.abort();
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: 50,
      seed: 1,
      signal: controller.signal,
      oracle,
    });

    expect(oracle.totalCalls).toBe(0);
    expect(report.aborted).toBe(true);
    expect(report.casesRun).toBe(0);
    expect(report.outcome).toBe("inconclusive");
    expect(report.matchScore).toBeUndefined();
  });
});

describe("Abort mid-run", () => {
  // **Validates: Requirements 9.13, 11.6**
  it("stops starting new cases and releases the handle exactly once", async () => {
    const controller = new AbortController();
    const oracle = createFakeOracle({
      run: ({ callIndex }) => {
        if (callIndex === 2) controller.abort(); // abort while the third case is in progress
        return okResult("x");
      },
    });
    const report = await runEquivalence({
      source: SOURCE,
      fields: INTEREST,
      candidate: () => "x",
      caseCount: 50,
      seed: 1,
      signal: controller.signal,
      oracle,
    });

    expect(report.aborted).toBe(true);
    expect(report.budgetReached).toBe(false);
    // The case in progress finishes; no further case starts.
    expect(report.casesRun).toBe(3);
    expect(oracle.runCalls).toBe(3);
    expect(oracle.compileCalls).toBe(1);
    expect(oracle.releaseCalls).toBe(1);
    expect(oracle.liveHandleIds).toEqual([]);
    expect(oracle.callOrder[oracle.callOrder.length - 1]).toBe("releaseHandle");
  });
});
