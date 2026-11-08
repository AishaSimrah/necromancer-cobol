import { invokeCandidate, outputsEqual, type Candidate } from "./compare.js";
import type { FieldDescriptor } from "./descriptors.js";
import { generateCases } from "./generate.js";
import { defaultOracle, type OraclePort } from "./oracle-port.js";
import { buildReport, type EquivalenceReport, type MismatchRecord } from "./report.js";

const DEFAULT_CASE_COUNT = 1000;
const DEFAULT_SEED = 1;

export interface RunOptions {
  readonly source: string;
  readonly fields: readonly FieldDescriptor[];
  readonly candidate: Candidate;
  readonly caseCount?: number;
  readonly seed?: number;
  readonly oracle?: OraclePort;
}

/**
 * Minimal slice: compile once, run each case sequentially, compare strictly.
 * Any non-ok Oracle result throws, so no score is produced from infrastructure failure.
 */
export async function runEquivalence(options: RunOptions): Promise<EquivalenceReport> {
  const oracle = options.oracle ?? defaultOracle;
  const caseCount = options.caseCount ?? DEFAULT_CASE_COUNT;
  const seed = options.seed ?? DEFAULT_SEED;
  const startedAt = Date.now();

  const compiled = await oracle.compileCobol(options.source);
  if (!oracle.isCompiledHandle(compiled)) {
    throw new Error(
      `Oracle could not compile the source: ${compiled.status}${
        compiled.message === undefined ? "" : ` (${compiled.message})`
      }`,
    );
  }

  const cases = generateCases(options.fields, caseCount, seed);
  const mismatches: MismatchRecord[] = [];
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
      const outcome = await invokeCandidate(options.candidate, testCase.lines);
      if (outcome.kind === "output" && outputsEqual(result.stdout, outcome.text)) {
        matchedCount++;
      } else {
        mismatches.push({
          input: testCase.lines,
          oracleOutput: result.stdout,
          candidateOutput: outcome.text,
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
    elapsedMs: Date.now() - startedAt,
  });
}
