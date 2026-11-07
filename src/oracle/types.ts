/**
 * Public types of the COBOL Oracle Runner.
 * These signatures are final: they MUST NOT change in Phases B and C.
 */

export type Status =
  | "ok"
  | "compile_error"
  | "timeout"
  | "source_too_large"
  | "invalid_request"
  | "resource_limit"
  | "environment_error";

export interface RunRequest {
  readonly source: string;
  readonly inputLines: readonly string[];
  /** Default 5000, max 60000. */
  readonly runTimeoutMs?: number;
}

export interface RunResult {
  readonly status: Status;
  readonly stdout: string;
  readonly stderr: string;
  /** null when no process ran or it was killed. */
  readonly exitCode: number | null;
  readonly truncated: boolean;
  readonly durationMs: number;
  /** Present if and only if status !== "ok". Omitted (not undefined) when ok. */
  readonly message?: string;
}

declare const handleBrand: unique symbol;

export interface CompiledHandle {
  readonly id: string;
  readonly [handleBrand]: true;
}

/** Narrows the result of `compileCobol` to a handle. */
export function isCompiledHandle(x: CompiledHandle | RunResult): x is CompiledHandle {
  const candidate = x as { id?: unknown; status?: unknown };
  return typeof candidate.id === "string" && candidate.status === undefined;
}
