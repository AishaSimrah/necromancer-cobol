import type { ErrorWire } from "./wire.js";

export type ErrorCode =
  | "internal_error"
  | "not_found"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_body"
  | "unknown_key"
  | "invalid_sample_id"
  | "invalid_variant"
  | "invalid_case_count"
  | "invalid_seed"
  | "busy"
  | "oracle_unavailable"
  | "shutting_down"
  | "inconclusive"
  | "engine_config"
  | "timeout";

/**
 * HTTP status per code when the error is sent as a plain response.
 * `oracle_unavailable` is 503 before a stream starts. Inside a stream the
 * status is already 200 (headers sent), for `oracle_unavailable`,
 * `inconclusive`, `engine_config`, `internal_error` and `timeout`.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  internal_error: 500,
  not_found: 404,
  method_not_allowed: 405,
  unsupported_media_type: 415,
  payload_too_large: 413,
  invalid_json: 400,
  invalid_body: 400,
  unknown_key: 400,
  invalid_sample_id: 400,
  invalid_variant: 400,
  invalid_case_count: 400,
  invalid_seed: 400,
  busy: 429,
  oracle_unavailable: 503,
  shutting_down: 503,
  inconclusive: 200,
  engine_config: 200,
  timeout: 200,
});

/** Fixed messages. `unknown_key` and `invalid_case_count` are built by the helpers below. */
export const FIXED_MESSAGES: Readonly<Record<Exclude<ErrorCode, "unknown_key" | "invalid_case_count">, string>> =
  Object.freeze({
    internal_error: "Internal server error.",
    not_found: "No such endpoint.",
    method_not_allowed: "Method not allowed.",
    unsupported_media_type: "Content-Type must be application/json.",
    payload_too_large: "Request body must be at most 1024 bytes.",
    invalid_json: "Body must be a JSON object.",
    invalid_body: "Body must be a JSON object.",
    invalid_sample_id: "sampleId must be one of: interest, payroll, tax.",
    invalid_variant: "variant must be one of: correct, subtle, naive.",
    invalid_seed: "seed must be an integer from -2147483648 to 2147483647.",
    busy: "A proof is already running. Try again soon.",
    oracle_unavailable: "The oracle is not available.",
    shutting_down: "The server is shutting down.",
    inconclusive: "No conclusive case ran.",
    engine_config: "The run was rejected.",
    timeout: "The run did not stop in time.",
  });

/** Messages for other 404 cases. */
export const NOT_FOUND_SAMPLE_MESSAGE = "No such sample.";
export const NOT_FOUND_STATIC_MESSAGE = "Not found.";
/** `oracle_unavailable` when the Engine reports it inside a stream. */
export const ORACLE_FAILED_DURING_RUN_MESSAGE = "The oracle failed during the run.";

const KEY_ECHO_LIMIT = 40;

export function errorBody(code: ErrorCode, message: string): ErrorWire {
  return { type: "error", code, message };
}

export function statusOf(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

export function unknownKeyMessage(key: string): string {
  const quoted = JSON.stringify(key.slice(0, KEY_ECHO_LIMIT));
  return `Unknown key ${quoted}. Allowed: sampleId, variant, caseCount, seed.`;
}

export function caseCountMessage(max: number): string {
  return `caseCount must be an integer from 100 to ${String(max)}.`;
}
