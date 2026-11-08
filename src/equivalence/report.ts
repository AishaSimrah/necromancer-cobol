import { GROUP_ORDER, type EvidenceGroup } from "./classify.js";

/**
 * Report for the vertical slice plus per-group summaries. Later tasks extend it
 * with inconclusive handling, shrinking and the mismatch list cap.
 */

export interface MismatchRecord {
  readonly input: readonly string[];
  readonly oracleOutput: string;
  readonly candidateOutput: string;
  readonly group: EvidenceGroup;
}

export interface GroupSummary {
  readonly group: EvidenceGroup;
  readonly conclusive: number;
  readonly matched: number;
  readonly inconclusive: number;
}

/** Mutable per-group tallies kept by the run loop. */
export interface GroupCounter {
  matched: number;
  mismatched: number;
  inconclusive: number;
}

export type GroupCounters = Record<EvidenceGroup, GroupCounter>;

export function createGroupCounters(): GroupCounters {
  return {
    "field overflow behavior": { matched: 0, mismatched: 0, inconclusive: 0 },
    "half-unit rounding boundary": { matched: 0, mismatched: 0, inconclusive: 0 },
    "zero and maximum boundaries": { matched: 0, mismatched: 0, inconclusive: 0 },
    "standard computation": { matched: 0, mismatched: 0, inconclusive: 0 },
  };
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
  /** Always the four groups, in GROUP_ORDER. Conclusive counts sum to `conclusiveCount`. */
  readonly groups: readonly GroupSummary[];
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
  readonly groupCounters: GroupCounters;
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
    groups: GROUP_ORDER.map((group): GroupSummary => {
      const c = input.groupCounters[group];
      return {
        group,
        conclusive: c.matched + c.mismatched,
        matched: c.matched,
        inconclusive: c.inconclusive,
      };
    }),
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
