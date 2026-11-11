import { GROUP_ORDER, type EvidenceGroup } from "./classify.js";
import { invokeCandidate, outputsEqual } from "./compare.js";
import { resolveConfig, type EquivalenceOptions } from "./config.js";
import { generateCases } from "./generate.js";
import { defaultOracle } from "./oracle-port.js";
import {
  buildReport,
  buildUnavailableReport,
  createGroupCounters,
  createShrinkCalls,
  type EquivalenceReport,
  type InconclusiveCase,
  type MismatchRecord,
} from "./report.js";
import { shrinkGroup, type ShrinkContext, type ShrunkExample } from "./shrink.js";

export type RunOptions = EquivalenceOptions;

/** Read at call time so TypeScript does not narrow `signal.aborted` across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

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
  const { now, signal, timeBudgetMs, oracleTimeoutMs } = config;
  const startedAt = now();

  if (isAborted(signal)) {
    return buildReport({
      seed,
      casesRun: 0,
      matchedCount: 0,
      mismatches: [],
      groupCounters: createGroupCounters(),
      elapsedMs: now() - startedAt,
      aborted: true,
    });
  }

  const compiled = await oracle.compileCobol(config.source);
  if (!oracle.isCompiledHandle(compiled)) {
    return buildUnavailableReport({
      seed,
      status: compiled.status === "ok" ? "environment_error" : compiled.status,
      message: compiled.message ?? "",
      elapsedMs: now() - startedAt,
    });
  }

  const cases = generateCases(config.fields, caseCount, seed);
  const mismatches: MismatchRecord[] = [];
  const inconclusiveCases: InconclusiveCase[] = [];
  const groupCounters = createGroupCounters();
  const firstMismatch = new Map<EvidenceGroup, MismatchRecord>();
  const shrunkExamples: ShrunkExample[] = [];
  const shrinkOracleCalls = createShrinkCalls();
  let matchedCount = 0;
  let casesRun = 0;
  let aborted = false;
  let budgetReached = false;
  const runOptions = oracleTimeoutMs !== undefined ? { runTimeoutMs: oracleTimeoutMs } : undefined;

  const target = cases.length;
  const emitProgress = async (group: EvidenceGroup): Promise<void> => {
    if (config.onProgress === undefined) return;
    try {
      await config.onProgress({
        completed: casesRun,
        target,
        group,
        matched: matchedCount,
        mismatches: mismatches.length,
        inconclusive: inconclusiveCases.length,
      });
    } catch {
      // Progress reporting must never affect the run.
    }
  };

  try {
    for (const testCase of cases) {
      if (isAborted(signal)) {
        aborted = true;
        break;
      }
      if (timeBudgetMs !== undefined && now() - startedAt >= timeBudgetMs) {
        budgetReached = true;
        break;
      }
      const result = await oracle.runCompiled(compiled, testCase.lines, runOptions);
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
        await emitProgress(testCase.group);
        continue;
      }
      const outcome = await invokeCandidate(config.candidate, testCase.lines);
      if (outcome.kind === "output" && outputsEqual(result.stdout, outcome.text)) {
        matchedCount++;
        counter.matched++;
      } else {
        counter.mismatched++;
        const record: MismatchRecord = {
          input: testCase.lines,
          oracleOutput: result.stdout,
          candidateOutput: outcome.text,
          group: testCase.group,
        };
        mismatches.push(record);
        if (!firstMismatch.has(testCase.group)) firstMismatch.set(testCase.group, record);
      }
      await emitProgress(testCase.group);
    }

    // Shrink each group that has a Mismatch, in GROUP_ORDER; stop once aborted.
    for (const group of GROUP_ORDER) {
      const start = firstMismatch.get(group);
      if (start === undefined) continue;
      if (isAborted(signal)) {
        aborted = true;
        break;
      }
      const shrinkCtx: ShrinkContext = {
        oracle,
        handle: compiled,
        candidate: config.candidate,
        fields: config.fields,
        seed,
        limit: config.shrinkLimit,
        ...(oracleTimeoutMs !== undefined ? { runTimeoutMs: oracleTimeoutMs } : {}),
        ...(signal !== undefined ? { signal } : {}),
      };
      const shrunk = await shrinkGroup(shrinkCtx, start);
      shrunkExamples.push(shrunk.example);
      shrinkOracleCalls[group] = shrunk.oracleCalls;
      if (isAborted(signal)) aborted = true;
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
    shrunkExamples,
    shrinkOracleCalls,
    elapsedMs: now() - startedAt,
    budgetReached,
    aborted,
  });
}
