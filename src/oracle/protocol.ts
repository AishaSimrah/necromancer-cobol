/**
 * Worker protocol types. Every request has a unique string `id`; every
 * response echoes it. Binary data is base64 inside JSON.
 */

export type WorkerRequest =
  | { id: string; type: "ping"; withVersion?: boolean }
  | { id: string; type: "compile"; handleId: string; source: string; timeoutMs: number }
  | {
      id: string;
      type: "run";
      handleId: string;
      inputLines: readonly string[];
      timeoutMs: number;
      outputLimitBytes: number;
    }
  | { id: string; type: "release"; handleId: string }
  | { id: string; type: "shutdown" };

export type EndedBy = "exit" | "timeout" | "output_limit" | "limit" | "spawn_error";

export type BreachedLimit = "memory" | "cpu" | "processes" | "file_size";

export interface RawOutcomeFields {
  stdoutB64: string;
  stderrB64: string;
  exitCode: number | null;
  signal: string | null;
  endedBy: EndedBy;
  /** Set iff endedBy === "limit". */
  limit: BreachedLimit | null;
  truncated: boolean;
  /** Measured in the Worker, spawn to close. */
  durationMs: number;
}

export type WorkerResponse =
  | {
      id: string;
      type: "pong";
      pid: number;
      liveHandles: number;
      busySlots: number;
      cobcVersionOutput?: string;
    }
  | { id: string; type: "compiled"; ok: true; handleId: string; outcome: RawOutcomeFields }
  | { id: string; type: "compiled"; ok: false; outcome: RawOutcomeFields }
  | { id: string; type: "ran"; outcome: RawOutcomeFields }
  | { id: string; type: "released" }
  | { id: string; type: "shutdown_ack" }
  | {
      id: string;
      type: "error";
      code: "unknown_handle" | "bad_request" | "internal";
      message: string;
    };

export type WorkerMessage = WorkerRequest | WorkerResponse;
