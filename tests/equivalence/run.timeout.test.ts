import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import type { OraclePort } from "../../src/equivalence/oracle-port.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

type RunCompiledArgs = Parameters<OraclePort["runCompiled"]>;

/** Wraps the fake Oracle and records the full argument list of every runCompiled call. */
function recordingOracle(): { oracle: OraclePort; calls: RunCompiledArgs[] } {
  const fake = createFakeOracle({ run: okResult("x") });
  const calls: RunCompiledArgs[] = [];
  const oracle: OraclePort = {
    compileCobol: (source) => fake.compileCobol(source),
    runCompiled: (...args: RunCompiledArgs) => {
      calls.push(args);
      return fake.runCompiled(args[0], args[1]);
    },
    releaseHandle: (handle) => fake.releaseHandle(handle),
    isCompiledHandle: (x) => fake.isCompiledHandle(x),
  };
  return { oracle, calls };
}

describe("Property 17: Oracle timeout passthrough", () => {
  // Feature: equivalence-engine, Property 17: Oracle timeout passthrough
  // **Validates: Requirements 9.11**
  it("passes { runTimeoutMs } to every runCompiled call when oracleTimeoutMs is configured", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 600000 }),
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: -1000, max: 1000 }),
        async (timeout, caseCount, seed) => {
          const { oracle, calls } = recordingOracle();
          const report = await runEquivalence({
            source: "IDENTIFICATION DIVISION.",
            fields: INTEREST,
            candidate: () => "x",
            caseCount,
            seed,
            oracleTimeoutMs: timeout,
            oracle,
          });
          expect(calls.length).toBe(report.casesRun);
          expect(calls.length).toBeGreaterThan(0);
          for (const args of calls) {
            expect(args[2]).toEqual({ runTimeoutMs: timeout });
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("omits the opts argument on every runCompiled call when oracleTimeoutMs is not configured", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: -1000, max: 1000 }),
        async (caseCount, seed) => {
          const { oracle, calls } = recordingOracle();
          const report = await runEquivalence({
            source: "IDENTIFICATION DIVISION.",
            fields: INTEREST,
            candidate: () => "x",
            caseCount,
            seed,
            oracle,
          });
          expect(calls.length).toBe(report.casesRun);
          expect(calls.length).toBeGreaterThan(0);
          for (const args of calls) {
            expect(args[2]).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
