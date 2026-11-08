import type { EvidenceGroup } from "./classify.js";

/**
 * Minimal report for the vertical slice. Later tasks extend it with groups,
 * inconclusive handling, shrinking and the mismatch list cap.
 */

export interface MismatchRecord {
  readonly input: readonly string[];
  readonly oracleOutput: string;
  readonly candidateOutput: string;
}

export type Outcome = "completed" | "inconclusive";

export interface EquivalenceReport {
  readonly outcome: Outcome;
  /** Absent unless at least one conclusive case ran. */
  readonly matchScore?: number;
  readonly seed: number;
  readonly casesRun: number;
  readonly conclusiveCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly MismatchRecord[];
  readonly elapsedMs: number;
}

/** Progress snapshot after each finished case. Deliberately has no score field. */
export interface ProgressEvent {
  readonly completed: number;
  readonly target: number;
  readonly group: EvidenceGroup;
  readonly matched: number;
  readonly mismatches: number;
  readonly inconclusive: number;
}

export type ProgressCallback = (event: ProgressEvent) => void | Promise<void>;

export interface ReportInput {
  readonly seed: number;
  readonly casesRun: number;
  readonly matchedCount: number;
  readonly mismatches: readonly MismatchRecord[];
  readonly elapsedMs: number;
}

/** Builds the report. `matchScore` uses exactly one division: matched / conclusive. */
export function buildReport(input: ReportInput): EquivalenceReport {
  const mismatchCount = input.mismatches.length;
  const conclusiveCount = input.matchedCount + mismatchCount;
  const base = {
    seed: input.seed,
    casesRun: input.casesRun,
    conclusiveCount,
    matchedCount: input.matchedCount,
    mismatchCount,
    mismatches: input.mismatches,
    elapsedMs: input.elapsedMs,
  };
  if (conclusiveCount === 0) {
    return { outcome: "inconclusive", ...base };
  }
  return {
    outcome: "completed",
    matchScore: input.matchedCount / conclusiveCount,
    ...base,
  };
}
