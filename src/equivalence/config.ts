import type { Candidate } from "./compare.js";
import { validateDescriptors, type FieldDescriptor } from "./descriptors.js";
import { EquivalenceConfigError } from "./errors.js";
import type { OraclePort } from "./oracle-port.js";
import type { ProgressCallback } from "./report.js";

export { EquivalenceConfigError };
export type { Candidate };

export const DEFAULT_CASE_COUNT = 1000;
export const DEFAULT_MISMATCH_LIST_CAP = 25;
export const DEFAULT_SHRINK_LIMIT = 200;

const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

export interface EquivalenceOptions {
  /** COBOL source. */
  readonly source: string;
  readonly fields: readonly FieldDescriptor[];
  readonly candidate: Candidate;
  /** Integer 1..100000, default 1000. */
  readonly caseCount?: number;
  /** int32. A seed is chosen when absent and returned in the report. */
  readonly seed?: number;
  /** Integer 1..3600000, default none. */
  readonly timeBudgetMs?: number;
  /** Passed to runCompiled as runTimeoutMs; omitted when unset. */
  readonly oracleTimeoutMs?: number;
  /** Integer 1..10000, default 25. */
  readonly mismatchListCap?: number;
  /** Integer 1..10000, default 200. */
  readonly shrinkLimit?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressCallback;
  /** Default: the real oracle. */
  readonly oracle?: OraclePort;
  /** Millisecond clock. Default: performance.now-based. */
  readonly now?: () => number;
}

export interface ResolvedConfig {
  readonly source: string;
  readonly fields: readonly FieldDescriptor[];
  readonly candidate: Candidate;
  readonly caseCount: number;
  readonly seed: number;
  readonly timeBudgetMs?: number;
  readonly oracleTimeoutMs?: number;
  readonly mismatchListCap: number;
  readonly shrinkLimit: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: ProgressCallback;
  readonly oracle?: OraclePort;
  readonly now: () => number;
}

function checkIntRange(setting: string, value: number, min: number, max: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new EquivalenceConfigError(`${setting}: must be an integer from ${min} to ${max}`);
  }
}

function chooseSeed(): number {
  return Math.floor(Math.random() * 2 ** 32) + INT32_MIN;
}

function defaultNow(): number {
  return Math.floor(performance.now());
}

/** Validates descriptors then options (caseCount, seed, timeBudgetMs, mismatchListCap, shrinkLimit) and applies defaults. */
export function resolveConfig(opts: EquivalenceOptions): ResolvedConfig {
  validateDescriptors(opts.fields);

  const caseCount = opts.caseCount ?? DEFAULT_CASE_COUNT;
  checkIntRange("caseCount", caseCount, 1, 100000);

  if (opts.seed !== undefined) {
    checkIntRange("seed", opts.seed, INT32_MIN, INT32_MAX);
  }
  if (opts.timeBudgetMs !== undefined) {
    checkIntRange("timeBudgetMs", opts.timeBudgetMs, 1, 3600000);
  }

  const mismatchListCap = opts.mismatchListCap ?? DEFAULT_MISMATCH_LIST_CAP;
  checkIntRange("mismatchListCap", mismatchListCap, 1, 10000);

  const shrinkLimit = opts.shrinkLimit ?? DEFAULT_SHRINK_LIMIT;
  checkIntRange("shrinkLimit", shrinkLimit, 1, 10000);

  return {
    source: opts.source,
    fields: opts.fields,
    candidate: opts.candidate,
    caseCount,
    seed: opts.seed ?? chooseSeed(),
    ...(opts.timeBudgetMs !== undefined ? { timeBudgetMs: opts.timeBudgetMs } : {}),
    ...(opts.oracleTimeoutMs !== undefined ? { oracleTimeoutMs: opts.oracleTimeoutMs } : {}),
    mismatchListCap,
    shrinkLimit,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
    ...(opts.oracle !== undefined ? { oracle: opts.oracle } : {}),
    now: opts.now ?? defaultNow,
  };
}
