import { SAMPLE_IDS, VARIANTS } from "../translator/index.js";
import type { SampleId, Variant } from "../translator/types.js";
import { caseCountMessage, FIXED_MESSAGES, unknownKeyMessage } from "./errors.js";
import type { ErrorCode } from "./errors.js";
import type { ProveRequest } from "./wire.js";

export type { ProveRequest } from "./wire.js";

export interface ValidationFailure {
  readonly ok: false;
  readonly status: 400;
  readonly code: ErrorCode;
  readonly message: string;
}

export type Validation =
  | { readonly ok: true; readonly value: ProveRequest }
  | ValidationFailure;

export interface CaseCountLimits {
  readonly min: 100;
  readonly default: number;
  readonly max: number;
}

const ALLOWED_KEYS: readonly string[] = ["sampleId", "variant", "caseCount", "seed"];
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function fail(code: ErrorCode, message: string): ValidationFailure {
  return { ok: false, status: 400, code, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOwn(body: Record<string, unknown>, key: string): { present: boolean; value: unknown } {
  if (!Object.hasOwn(body, key)) return { present: false, value: undefined };
  return { present: true, value: body[key] };
}

function pickSampleId(value: unknown): SampleId | null {
  if (typeof value !== "string") return null;
  return SAMPLE_IDS.includes(value as SampleId) ? (value as SampleId) : null;
}

function pickVariant(value: unknown): Variant | null {
  if (typeof value !== "string") return null;
  return VARIANTS.includes(value as Variant) ? (value as Variant) : null;
}

function isValidCaseCount(value: unknown, limits: CaseCountLimits): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= limits.min &&
    value <= limits.max
  );
}

function isValidSeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= INT32_MIN &&
    value <= INT32_MAX
  );
}

/** Pure and total over `unknown`. Never throws. */
export function validateProveRequest(body: unknown, limits: CaseCountLimits): Validation {
  if (!isRecord(body)) return fail("invalid_body", FIXED_MESSAGES.invalid_body);

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.includes(key)) return fail("unknown_key", unknownKeyMessage(key));
  }

  const sampleId = pickSampleId(readOwn(body, "sampleId").value);
  if (sampleId === null) return fail("invalid_sample_id", FIXED_MESSAGES.invalid_sample_id);

  const variant = pickVariant(readOwn(body, "variant").value);
  if (variant === null) return fail("invalid_variant", FIXED_MESSAGES.invalid_variant);

  const rawCount = readOwn(body, "caseCount");
  let caseCount = limits.default;
  if (rawCount.present) {
    if (!isValidCaseCount(rawCount.value, limits)) {
      return fail("invalid_case_count", caseCountMessage(limits.max));
    }
    caseCount = rawCount.value;
  }

  const rawSeed = readOwn(body, "seed");
  let seed: number | undefined;
  if (rawSeed.present) {
    if (!isValidSeed(rawSeed.value)) return fail("invalid_seed", FIXED_MESSAGES.invalid_seed);
    seed = rawSeed.value + 0; // -0 + 0 === 0
  }

  return { ok: true, value: { sampleId, variant, caseCount, seed } };
}
