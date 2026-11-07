/**
 * Pure request validation. No process or file is touched here.
 *
 * Fixed check order (first failing check wins, so results are deterministic):
 *   1. source size (UTF-8 bytes)
 *   2. source empty or whitespace only
 *   3. source contains NUL
 *   4. source scans (external call, forbidden constructs) - placeholder, Task 4.1
 *   5. input lines
 *   6. timeout
 */

import type { OracleConfig } from "./config.js";
import type { RunRequest } from "./types.js";

export type Rejection = {
  status: "invalid_request" | "source_too_large";
  message: string;
};

/** Size, emptiness and NUL checks, then the scan placeholder. */
export function validateSource(source: string, cfg: OracleConfig): Rejection | null {
  const bytes = Buffer.byteLength(source, "utf8");
  if (bytes > cfg.sourceSizeLimitBytes) {
    return {
      status: "source_too_large",
      message: `source is ${bytes} bytes, which exceeds the limit of ${cfg.sourceSizeLimitBytes} bytes`,
    };
  }
  if (source.trim().length === 0) {
    return { status: "invalid_request", message: "source is empty or contains only whitespace" };
  }
  if (source.includes("\u0000")) {
    return { status: "invalid_request", message: "source contains a NUL character" };
  }
  return validateSourceScans(source);
}

/**
 * Placeholder for the source scans (external call, forbidden constructs).
 * Task 4.1 fills this in; it must run after the NUL check.
 */
function validateSourceScans(source: string): Rejection | null {
  void source; // unused until task 4.1
  return null;
}

/** Each line must be free of CR and LF; the total size is bounded. */
export function validateInputLines(
  lines: readonly string[],
  cfg: OracleConfig,
): Rejection | null {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.includes("\n") || line.includes("\r")) {
      return {
        status: "invalid_request",
        message: `input line ${i + 1} contains a line feed or carriage return character`,
      };
    }
    total += Buffer.byteLength(line, "utf8");
  }
  if (total > cfg.inputSizeLimitBytes) {
    return {
      status: "invalid_request",
      message: `input lines total ${total} bytes, which exceeds the limit of ${cfg.inputSizeLimitBytes} bytes`,
    };
  }
  return null;
}

/** `undefined` means "use the default". Otherwise a positive number up to the maximum. */
export function validateTimeout(ms: number | undefined, cfg: OracleConfig): Rejection | null {
  if (ms === undefined) return null;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return { status: "invalid_request", message: "runTimeoutMs must be a positive number" };
  }
  if (ms > cfg.maxRunTimeoutMs) {
    return {
      status: "invalid_request",
      message: `runTimeoutMs ${ms} exceeds the maximum of ${cfg.maxRunTimeoutMs} ms`,
    };
  }
  return null;
}

/** Runs every check in the fixed order. */
export function validateRequest(req: RunRequest, cfg: OracleConfig): Rejection | null {
  return (
    validateSource(req.source, cfg) ??
    validateInputLines(req.inputLines, cfg) ??
    validateTimeout(req.runTimeoutMs, cfg)
  );
}
