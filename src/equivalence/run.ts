import { invokeCandidate, outputsEqual, type Candidate } from "./compare.js";
import { resolveConfig, type EquivalenceOptions } from "./config.js";
import { generateCases } from "./generate.js";
import { defaultOracle } from "./oracle-port.js";
import { buildReport, createGroupCounters, type EquivalenceReport, type MismatchRecord } from "./report.js";

export type RunOptions = EquivalenceOptions;

/**
 * Minimal slice: compile once, run each case sequentially, compare strictly.
 * Any non-ok Oracle result throws, so no score is produced from infrastructure failure.
 */
export async function runEquivalence(options: RunOptions): Promise<EquivalenceReport> {
  // Throws EquivalenceConfigError (rejecting the promise) before any Oracle call.
  const config = resolveConfig(options);
  const { caseCount, seed } = config;
  const oracle = config.oracle ?? defaultOracle;
  const startedAt = Date.now();

  const compiled = await oracle.compileCobol(config.source);
  if (!oracle.isCompiledHandle(compiled)) {
    throw new Error(
      `Oracle could not compile the source: ${compiled.status}${
        compiled.message === undefined ? "" : ` (${compiled.message})`
      }`,
    );
  }

  const cases = generateCases(config.fields, caseCount, seed);
  const mismatches: MismatchRecord[] = [];
  const groupCounters = createGroupCounters();
  let matchedCount = 0;
  let casesRun = 0;

  try {
    for (const testCase of cases) {
      const result = await oracle.runCompiled(compiled, testCase.lines);
      if (result.status !== "ok") {
        throw new Error(
          `Oracle run failed on case ${testCase.index}: ${result.status}${
            result.message === undefined ? "" : ` (${result.message})`
          }`,
        );
      }
      const outcome = await invokeCandidate(config.candidate, testCase.lines);
      const counter = groupCounters[testCase.group];
      if (outcome.kind === "output" && outputsEqual(result.stdout, outcome.text)) {
        matchedCount++;
        counter.matched++;
      } else {
        counter.mismatched++;
        mismatches.push({
          input: testCase.lines,
          oracleOutput: result.stdout,
          candidateOutput: outcome.text,
          group: testCase.group,
        });
      }
      casesRun++;
    }
  } finally {
    try {
      await oracle.releaseHandle(compiled);
    } catch {
      // A release failure must not mask the original error.
    }
  }

  return buildReport({
    seed,
    casesRun,
    matchedCount,
    mismatches,
    groupCounters,
    elapsedMs: Date.now() - startedAt,
  });
}
