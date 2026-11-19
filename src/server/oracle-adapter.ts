import type { OraclePort } from "../equivalence/index.js";
import type { PartialOracleConfig } from "../oracle/config.js";
import type { CompiledHandle, RunResult } from "../oracle/index.js";
import type { OracleBackend } from "./types.js";

export interface OracleAdapter {
  readonly sharedConfig: PartialOracleConfig;
  readonly port: OraclePort;
  readonly backend: OracleBackend;
  compile(source: string): Promise<CompiledHandle | RunResult>;
  reset(): Promise<void>;
}

export interface OracleAdapterOptions {
  readonly backend: OracleBackend;
  readonly workRoot: string;
}

function buildSharedConfig(workRoot: string): PartialOracleConfig {
  const workerCommand: readonly string[] = Object.freeze([
    "node",
    "/opt/oracle/worker.js",
    "--work-root",
    workRoot,
  ]);
  return Object.freeze({ workerCommand });
}

export function createOracleAdapter(options: OracleAdapterOptions): OracleAdapter {
  const { backend, workRoot } = options;
  const sharedConfig = buildSharedConfig(workRoot);

  // The ONLY compileCobol call site in src/server. The Oracle keeps one
  // module-level Worker client created from the first config it sees, and its
  // default work directory `/work` cannot be created by a non-root user. Every
  // compile must therefore pass the same shared config.
  const compile = (source: string): Promise<CompiledHandle | RunResult> =>
    backend.compileCobol(source, sharedConfig);

  const port: OraclePort = {
    // Caller-supplied config is ignored on purpose.
    compileCobol: (source: string) => compile(source),
    runCompiled: (handle, inputLines, opts) => backend.runCompiled(handle, inputLines, opts),
    releaseHandle: (handle) => backend.releaseHandle(handle),
    isCompiledHandle: (value): value is CompiledHandle => backend.isCompiledHandle(value),
  };

  return {
    sharedConfig,
    port,
    backend,
    compile,
    reset: () => backend.shutdown(),
  };
}
