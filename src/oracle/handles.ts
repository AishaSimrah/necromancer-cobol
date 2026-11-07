/**
 * Minimal handle registry and the pipeline behind the public API.
 * Every outcome resolves as a RunResult; internal exceptions and launch
 * failures become `environment_error`. No version check, no restart/retry.
 */

import { randomBytes } from "node:crypto";
import { classifyOutcome } from "./classify.js";
import type { Logger, OracleConfig } from "./config.js";
import { selectLauncher } from "./launcher.js";
import type { RawOutcomeFields } from "./protocol.js";
import type { CompiledHandle, RunResult } from "./types.js";
import { validateInputLines, validateSource, validateTimeout } from "./validate.js";
import { WorkerClient } from "./worker-client.js";

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

interface HandleEntry {
  readonly cfg: OracleConfig;
}

const registry = new Map<string, HandleEntry>();
let client: WorkerClient | null = null;

function getClient(cfg: OracleConfig): WorkerClient {
  client ??= new WorkerClient(selectLauncher(), cfg, noopLogger);
  return client;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Builds a RunResult; `message` is omitted when the status is ok. */
function makeResult(
  status: RunResult["status"],
  message: string,
  extra: Partial<Pick<RunResult, "stdout" | "stderr" | "durationMs">> = {},
): RunResult {
  return {
    status,
    stdout: extra.stdout ?? "",
    stderr: extra.stderr ?? "",
    exitCode: null,
    truncated: false,
    durationMs: extra.durationMs ?? 0,
    message,
  };
}

function envError(err: unknown): RunResult {
  return makeResult("environment_error", describe(err));
}

function toHandle(id: string): CompiledHandle {
  return { id } as unknown as CompiledHandle;
}

function newHandleId(): string {
  return `h${randomBytes(12).toString("hex")}`;
}

function outcomeOf(response: { type: string; outcome?: RawOutcomeFields }): RawOutcomeFields | null {
  return response.outcome ?? null;
}

/** Compiles an already validated source. Returns a handle id or a failure result. */
export async function compileValidated(
  source: string,
  cfg: OracleConfig,
): Promise<{ handleId: string } | RunResult> {
  try {
    const handleId = newHandleId();
    const response = await getClient(cfg).request({
      type: "compile",
      handleId,
      source,
      timeoutMs: cfg.compileTimeoutMs,
    });
    if (response.type === "error") {
      return makeResult("environment_error", `worker error: ${response.message}`);
    }
    if (response.type !== "compiled") {
      return makeResult("environment_error", `unexpected worker response: ${response.type}`);
    }
    const outcome = outcomeOf(response);
    if (outcome === null) return makeResult("environment_error", "worker sent no outcome");
    const failure = classifyOutcome("compile", outcome, cfg.compileTimeoutMs);
    if (response.ok && failure === null) {
      registry.set(handleId, { cfg });
      return { handleId };
    }
    if (response.ok) await sendRelease(handleId);
    return (
      failure ?? makeResult("compile_error", "compilation failed", { stderr: "" })
    );
  } catch (err) {
    return envError(err);
  }
}

/** Runs a registered handle. The input lines must already be validated. */
export async function runValidated(
  handleId: string,
  inputLines: readonly string[],
  timeoutMs: number,
  cfg: OracleConfig,
): Promise<RunResult> {
  try {
    const response = await getClient(cfg).request({
      type: "run",
      handleId,
      inputLines,
      timeoutMs,
      outputLimitBytes: cfg.outputLimitBytes,
    });
    if (response.type === "error") {
      return makeResult("environment_error", `worker error (${response.code}): ${response.message}`);
    }
    if (response.type !== "ran") {
      return makeResult("environment_error", `unexpected worker response: ${response.type}`);
    }
    return classifyOutcome("run", response.outcome, timeoutMs) ??
      makeResult("environment_error", "run produced no result");
  } catch (err) {
    return envError(err);
  }
}

async function sendRelease(handleId: string): Promise<void> {
  try {
    if (client !== null) await client.request({ type: "release", handleId });
  } catch {
    // best effort: the Worker removes leftovers at shutdown
  }
}

export async function runCobolImpl(
  request: { source: string; inputLines: readonly string[]; runTimeoutMs?: number },
  cfg: OracleConfig,
): Promise<RunResult> {
  try {
    const rejection =
      validateSource(request.source, cfg) ??
      validateInputLines(request.inputLines, cfg) ??
      validateTimeout(request.runTimeoutMs, cfg);
    if (rejection !== null) return makeResult(rejection.status, rejection.message);

    const compiled = await compileValidated(request.source, cfg);
    if (!("handleId" in compiled)) return compiled;
    try {
      return await runValidated(
        compiled.handleId,
        request.inputLines,
        request.runTimeoutMs ?? cfg.defaultRunTimeoutMs,
        cfg,
      );
    } finally {
      registry.delete(compiled.handleId);
      await sendRelease(compiled.handleId);
    }
  } catch (err) {
    return envError(err);
  }
}

export async function compileCobolImpl(
  source: string,
  cfg: OracleConfig,
): Promise<CompiledHandle | RunResult> {
  try {
    const rejection = validateSource(source, cfg);
    if (rejection !== null) return makeResult(rejection.status, rejection.message);
    const compiled = await compileValidated(source, cfg);
    return "handleId" in compiled ? toHandle(compiled.handleId) : compiled;
  } catch (err) {
    return envError(err);
  }
}

export async function runCompiledImpl(
  handle: CompiledHandle,
  inputLines: readonly string[],
  opts?: { runTimeoutMs?: number },
): Promise<RunResult> {
  try {
    const entry = registry.get(handle?.id);
    if (entry === undefined) {
      return makeResult("invalid_request", "unknown or released handle");
    }
    const { cfg } = entry;
    const rejection =
      validateInputLines(inputLines, cfg) ?? validateTimeout(opts?.runTimeoutMs, cfg);
    if (rejection !== null) return makeResult(rejection.status, rejection.message);
    return await runValidated(
      handle.id,
      inputLines,
      opts?.runTimeoutMs ?? cfg.defaultRunTimeoutMs,
      cfg,
    );
  } catch (err) {
    return envError(err);
  }
}

export async function releaseHandleImpl(handle: CompiledHandle): Promise<void> {
  const id = handle?.id;
  if (typeof id !== "string" || !registry.delete(id)) return;
  await sendRelease(id);
}

export async function shutdownImpl(): Promise<void> {
  const ids = [...registry.keys()];
  registry.clear();
  try {
    await Promise.all(ids.map((id) => sendRelease(id)));
    if (client !== null) await client.stop();
  } catch {
    // never reject
  } finally {
    client = null;
  }
}
