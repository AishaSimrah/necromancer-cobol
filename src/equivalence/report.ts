import { GROUP_ORDER, type EvidenceGroup } from "./classify.js";
import type { Status } from "./oracle-port.js";

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

export type OracleStatus = Exclude<Status, "ok">;

export interface InconclusiveCase {
  readonly input: readonly string[];
  readonly group: EvidenceGroup;
  readonly status: OracleStatus;
  /** Empty string when the Oracle gave none. */
  readonly message: string;
}

export type Outcome = "completed" | "inconclusive" | "oracle_unavailable";

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
  readonly inconclusiveCases: readonly InconclusiveCase[];
  readonly inconclusiveCount: number;
  readonly inconclusiveByStatus: Readonly<Partial<Record<OracleStatus, number>>>;
  readonly containsInconclusive: boolean;
  readonly elapsedMs: number;
  /** Only for outcome "oracle_unavailable". */
  readonly oracleStatus?: OracleStatus;
  readonly oracleMessage?: string;
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
  readonly inconclusiveCases?: readonly InconclusiveCase[];
  readonly elapsedMs: number;
}

export interface UnavailableInput {
  readonly seed: number;
  readonly status: OracleStatus;
  readonly message: string;
  readonly elapsedMs: number;
}

/** Report for a compile failure: nothing ran, no score. */
export function buildUnavailableReport(input: UnavailableInput): EquivalenceReport {
  return {
    ...buildReport({
      seed: input.seed,
      casesRun: 0,
      matchedCount: 0,
      mismatches: [],
      groupCounters: createGroupCounters(),
      elapsedMs: input.elapsedMs,
    }),
    outcome: "oracle_unavailable",
    oracleStatus: input.status,
    oracleMessage: input.message,
  };
}

/** Builds the report. `matchScore` uses exactly one division: matched / conclusive. */
export function buildReport(input: ReportInput): EquivalenceReport {
  const mismatchCount = input.mismatches.length;
  const conclusiveCount = input.matchedCount + mismatchCount;
  const inconclusiveCases = input.inconclusiveCases ?? [];
  const inconclusiveByStatus: Partial<Record<OracleStatus, number>> = {};
  for (const c of inconclusiveCases) {
    inconclusiveByStatus[c.status] = (inconclusiveByStatus[c.status] ?? 0) + 1;
  }
  const base = {
    inconclusiveCases,
    inconclusiveCount: inconclusiveCases.length,
    inconclusiveByStatus,
    containsInconclusive: inconclusiveCases.length > 0,
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
