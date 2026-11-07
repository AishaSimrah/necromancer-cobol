import { mergeConfig, type PartialOracleConfig } from "./config.js";
import {
  compileCobolImpl,
  releaseHandleImpl,
  runCobolImpl,
  runCompiledImpl,
  shutdownImpl,
} from "./handles.js";
import type { CompiledHandle, RunRequest, RunResult } from "./types.js";

export type { CompiledHandle, RunRequest, RunResult, Status } from "./types.js";
export { isCompiledHandle } from "./types.js";

export function runCobol(request: RunRequest, config?: PartialOracleConfig): Promise<RunResult> {
  return runCobolImpl(request, mergeConfig(config));
}

export function compileCobol(
  source: string,
  config?: PartialOracleConfig,
): Promise<CompiledHandle | RunResult> {
  return compileCobolImpl(source, mergeConfig(config));
}

export function runCompiled(
  handle: CompiledHandle,
  inputLines: readonly string[],
  opts?: { runTimeoutMs?: number },
): Promise<RunResult> {
  return runCompiledImpl(handle, inputLines, opts);
}

export function releaseHandle(handle: CompiledHandle): Promise<void> {
  return releaseHandleImpl(handle);
}

export function shutdown(): Promise<void> {
  return shutdownImpl();
}
