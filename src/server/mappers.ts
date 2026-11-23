import type { EquivalenceReport } from "../equivalence/index.js";
import type { ProgressEvent } from "../equivalence/report.js";
import type { SampleId, Variant } from "../translator/types.js";
import {
  FIXED_MESSAGES,
  ORACLE_FAILED_DURING_RUN_MESSAGE,
  errorBody,
} from "./errors.js";
import type {
  ErrorWire,
  GroupWire,
  MismatchWire,
  ProgressWire,
  ReportWire,
  ShrunkWire,
} from "./wire.js";

/**
 * Allowlist mappers. Each builds a new literal from named properties; none
 * spreads or iterates its input, so unlisted Engine fields cannot leak.
 */

/** Request values echoed into the report. */
export interface ReportEcho {
  readonly sampleId: SampleId;
  readonly variant: Variant;
  readonly caseCount: number;
}

export function toProgressWire(e: ProgressEvent): ProgressWire {
  return {
    type: "progress",
    completed: e.completed,
    target: e.target,
    group: e.group,
    matched: e.matched,
    mismatches: e.mismatches,
    inconclusive: e.inconclusive,
  };
}

/** Throws unless the Engine reported a completed run with a score. */
export function toReportWire(report: EquivalenceReport, echo: ReportEcho): ReportWire {
  const matchScore = report.matchScore;
  if (report.outcome !== "completed" || matchScore === undefined) {
    throw new Error("toReportWire requires a completed report with a matchScore");
  }
  const groups: GroupWire[] = report.groups.map((g) => ({
    group: g.group,
    conclusive: g.conclusive,
    matched: g.matched,
    inconclusive: g.inconclusive,
  }));
  const mismatches: MismatchWire[] = report.mismatches.map((m) => ({
    input: [...m.input],
    oracleOutput: m.oracleOutput,
    candidateOutput: m.candidateOutput,
    group: m.group,
  }));
  const shrunkExamples: ShrunkWire[] = report.shrunkExamples.map((s) => ({
    group: s.group,
    input: [...s.input],
    oracleOutput: s.oracleOutput,
    candidateOutput: s.candidateOutput,
    limitReached: s.limitReached,
  }));
  const byStatus: Record<string, number> = {};
  for (const [status, count] of Object.entries(report.inconclusiveByStatus)) {
    if (typeof count === "number") byStatus[status] = count;
  }
  return {
    type: "report",
    sampleId: echo.sampleId,
    variant: echo.variant,
    caseCount: echo.caseCount,
    matchScore,
    complete: !report.aborted && !report.budgetReached,
    casesRun: report.casesRun,
    conclusiveCount: report.conclusiveCount,
    matchedCount: report.matchedCount,
    mismatchCount: report.mismatchCount,
    groups,
    mismatches,
    mismatchListTruncated: report.mismatchListTruncated,
    shrunkExamples,
    inconclusiveCount: report.inconclusiveCount,
    inconclusiveByStatus: byStatus,
    seed: report.seed,
    elapsedMs: report.elapsedMs,
    aborted: report.aborted,
    budgetReached: report.budgetReached,
  };
}

/**
 * Error event for a non-completed Engine outcome. Output has exactly
 * `type`, `code`, `message`, with fixed messages and no counts or score.
 */
export function toEngineErrorWire(report: Pick<EquivalenceReport, "outcome">): ErrorWire {
  switch (report.outcome) {
    case "inconclusive":
      return errorBody("inconclusive", FIXED_MESSAGES.inconclusive);
    case "oracle_unavailable":
      return errorBody("oracle_unavailable", ORACLE_FAILED_DURING_RUN_MESSAGE);
    case "completed":
      throw new Error("toEngineErrorWire cannot map a completed outcome");
  }
}
