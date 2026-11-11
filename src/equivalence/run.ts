import { invokeCandidate, outputsEqual } from "./compare.js";
import { resolveConfig, type EquivalenceOptions } from "./config.js";
import { generateCases } from "./generate.js";
import { defaultOracle } from "./oracle-port.js";
import {
  buildReport,
  buildUnavailableReport,
  createGroupCounters,
  type EquivalenceReport,
  type InconclusiveCase,
  type MismatchRecord,
} from "./report.js";

export type RunOptions = EquivalenceOptions;

/**
 * Compile once, run each case sequentially, compare strictly.
 * Non-ok Oracle results are recorded as inconclusive cases and excluded from the score.
 * Runtime Oracle errors propagate after the handle is released.
 */
export async function runEquivalence(options: RunOptions): Promise<EquivalenceReport> {
  // Throws EquivalenceConfigError (rejecting the promise) before any Oracle call.
  const config = resolveConfig(options);
  const { caseCount, seed } = config;
  const oracle = config.oracle ?? defaultOracle;
  const startedAt = Date.now();

  const compiled = await oracle.compileCobol(config.source);
  if (!oracle.isCompiledHandle(compiled)) {
    return buildUnavailableReport({
      seed,
      status: compiled.status === "ok" ? "environment_error" : compiled.status,
      message: compiled.message ?? "",
      elapsedMs: Date.now() - startedAt,
    });
  }

  const cases = generateCases(config.fields, caseCount, seed);
  const mismatches: MismatchRecord[] = [];
  const inconclusiveCases: InconclusiveCase[] = [];
  const groupCounters = createGroupCounters();
  let matchedCount = 0;
  let casesRun = 0;

  try {
    for (const testCase of cases) {
      const result = await oracle.runCompiled(compiled, testCase.lines);
      const counter = groupCounters[testCase.group];
      casesRun++;
      if (result.status !== "ok") {
        counter.inconclusive++;
        inconclusiveCases.push({
          input: testCase.lines,
          group: testCase.group,
          status: result.status,
          message: result.message ?? "",
        });
        continue;
      }
      const outcome = await invokeCandidate(config.candidate, testCase.lines);
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
    inconclusiveCases,
    elapsedMs: Date.now() - startedAt,
  });
}
