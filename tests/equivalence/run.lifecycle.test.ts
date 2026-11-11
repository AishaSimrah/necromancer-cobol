import { describe, it } from "vitest";
import fc from "fast-check";
import { INTEREST } from "../../src/equivalence/descriptors.js";
import { runEquivalence } from "../../src/equivalence/run.js";
import type { RunResult } from "../../src/equivalence/oracle-port.js";
import { createFakeOracle, failResult, okResult } from "./doubles/fake-oracle.js";

type NonOkStatus = Exclude<RunResult["status"], "ok">;
const NON_OK: readonly NonOkStatus[] = ["timeout", "resource_limit", "environment_error", "compile_error"];

type Scenario =
  | { readonly kind: "normal"; readonly releaseThrows: boolean }
  | { readonly kind: "compileFails"; readonly status: NonOkStatus; readonly message: string }
  | { readonly kind: "candidateFails"; readonly releaseThrows: boolean }
  | { readonly kind: "oracleThrows"; readonly at: number; readonly releaseThrows: boolean };

const scenarioArb: fc.Arbitrary<Scenario> = fc.oneof(
  fc.record({ kind: fc.constant<"normal">("normal"), releaseThrows: fc.boolean() }),
  fc.record({
    kind: fc.constant<"compileFails">("compileFails"),
    status: fc.constantFrom(...NON_OK),
    message: fc.string({ maxLength: 12 }),
  }),
  fc.record({ kind: fc.constant<"candidateFails">("candidateFails"), releaseThrows: fc.boolean() }),
  fc.record({
    kind: fc.constant<"oracleThrows">("oracleThrows"),
    at: fc.integer({ min: 0, max: 99 }),
    releaseThrows: fc.boolean(),
  }),
);

function check(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

describe("Property 11: Oracle lifecycle", () => {
  // Feature: equivalence-engine, Property 11: Oracle lifecycle
  // **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**
  it("compiles once, runs on that handle, releases exactly once, never masks the original error", async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        fc.integer({ min: 100, max: 120 }),
        fc.integer({ min: 0, max: 2147483647 }),
        async (scenario, caseCount, seed) => {
          const runtimeError = new Error("oracle runtime failure");
          const releaseError = new Error("release failure");
          const oracle = createFakeOracle({
            run: ({ callIndex }) => okResult(`out-${callIndex}`),
            ...(scenario.kind === "compileFails"
              ? { compileResult: failResult(scenario.status, scenario.message) }
              : {}),
            ...(scenario.kind === "oracleThrows"
              ? { throwOnRun: { error: runtimeError, when: (i: number) => i === scenario.at } }
              : {}),
            ...(scenario.kind !== "compileFails" && scenario.releaseThrows
              ? { throwOnRelease: releaseError }
              : {}),
          });
          const candidate =
            scenario.kind === "candidateFails"
              ? (): string => {
                  throw new Error("candidate boom");
                }
              : (): string => "different";

          let thrown: unknown;
          let report: Awaited<ReturnType<typeof runEquivalence>> | undefined;
          let returned = false;
          try {
            report = await runEquivalence({
              source: "IDENTIFICATION DIVISION.",
              fields: INTEREST,
              candidate,
              caseCount,
              seed,
              oracle,
            });
            returned = true;
          } catch (error) {
            thrown = error;
          }

          const log = oracle.callLog;
          const order = oracle.callOrder;

          // 2.1: compile exactly once, before any run.
          check(oracle.compileCalls === 1, "compileCobol called exactly once");
          check(order[0] === "compileCobol", "compile is the first call");

          if (scenario.kind === "compileFails") {
            check(returned && report !== undefined, "report returned on compile failure");
            check(report?.outcome === "oracle_unavailable", "outcome oracle_unavailable");
            check(report?.matchScore === undefined, "no matchScore");
            check(report?.casesRun === 0, "casesRun 0");
            check(oracle.runCalls === 0, "zero runCompiled calls");
            check(oracle.releaseCalls === 0, "zero releaseHandle calls");
            return;
          }

          // 2.2: every run uses the compiled handle.
          const handleIds = new Set<string>();
          for (const call of log) {
            if (call.kind === "runCompiled" || call.kind === "releaseHandle") handleIds.add(call.handleId);
          }
          check(handleIds.size <= 1, "all runCompiled/releaseHandle calls use a single handle");
          check(
            oracle.liveHandleIds.length === 0 || oracle.releaseCalls === 0,
            "handle not leaked",
          );

          // 2.4/2.5: release exactly once, after the last run, as the final call.
          check(oracle.releaseCalls === 1, "releaseHandle called exactly once");
          check(order[order.length - 1] === "releaseHandle", "release is the last call");
          check(order.lastIndexOf("runCompiled") < order.indexOf("releaseHandle"), "release after last run");
          check(oracle.liveHandleIds.length === 0, "no live handle remains");

          if (scenario.kind === "oracleThrows") {
            check(!returned, "runtime Oracle error rejects the run");
            check(thrown === runtimeError, "original Oracle error is not masked");
            check(oracle.runCalls === scenario.at + 1, "no runs after the throwing call");
          } else {
            check(returned && report !== undefined, "report returned despite release outcome");
            check(report?.casesRun === caseCount, "all cases ran");
            check(oracle.runCalls === caseCount, "one runCompiled per case");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
