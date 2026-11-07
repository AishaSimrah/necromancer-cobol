/**
 * Runner-side classification (pure): maps a Worker outcome and phase to a
 * RunResult. `message` is present iff the status is not "ok".
 */

import { decodeUtf8 } from "./capture.js";
import type { RawOutcomeFields } from "./protocol.js";
import type { RunResult } from "./types.js";

export type Phase = "compile" | "run";

function decodeB64(b64: string): string {
  return decodeUtf8(Buffer.from(b64, "base64"));
}

function build(
  outcome: RawOutcomeFields,
  fields: {
    status: RunResult["status"];
    stdout: string;
    exitCode: number | null;
    truncated: boolean;
    message?: string;
  },
): RunResult {
  const base = {
    status: fields.status,
    stdout: fields.stdout,
    stderr: decodeB64(outcome.stderrB64),
    exitCode: fields.exitCode,
    truncated: fields.truncated,
    durationMs: outcome.durationMs,
  };
  return fields.message === undefined ? base : { ...base, message: fields.message };
}

/**
 * Returns the RunResult for the outcome, or null when the compile phase
 * succeeded and the caller should continue to the run phase.
 * `timeoutMs` is the timeout that applied to the phase, used in the message.
 */
export function classifyOutcome(
  phase: Phase,
  outcome: RawOutcomeFields,
  timeoutMs: number,
): RunResult | null {
  const stdout = decodeB64(outcome.stdoutB64);

  switch (outcome.endedBy) {
    case "spawn_error":
      return build(outcome, {
        status: "environment_error",
        stdout: "",
        exitCode: null,
        truncated: false,
        message: `failed to start ${phase === "compile" ? "the compiler" : "the program"}: ${
          decodeB64(outcome.stderrB64).trim() || "spawn error"
        }`,
      });
    case "timeout":
      return build(outcome, {
        status: "timeout",
        stdout: phase === "compile" ? "" : stdout,
        exitCode: null,
        truncated: outcome.truncated,
        message: `${phase} phase timed out after ${timeoutMs} ms`,
      });
    case "output_limit":
      return build(outcome, {
        status: "resource_limit",
        stdout,
        exitCode: null,
        truncated: true,
        message: "output limit exceeded",
      });
    case "limit":
      // Labels for memory, CPU, process count and file size are added by Task 5.2.
      return build(outcome, {
        status: "resource_limit",
        stdout,
        exitCode: null,
        truncated: outcome.truncated,
        message: "resource limit exceeded",
      });
    case "exit":
      break;
  }

  if (phase === "compile") {
    if (outcome.exitCode === 0) return null;
    return build(outcome, {
      status: "compile_error",
      stdout: "",
      exitCode: outcome.exitCode,
      truncated: false,
      message: "compilation failed",
    });
  }

  return build(outcome, {
    status: "ok",
    stdout,
    exitCode: outcome.exitCode,
    truncated: outcome.truncated,
  });
}
