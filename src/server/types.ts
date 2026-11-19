import type { OraclePort, runEquivalence } from "../equivalence/index.js";
import type { PartialOracleConfig } from "../oracle/config.js";
import type { CompiledHandle, RunResult } from "../oracle/index.js";
import type { getSample, getTranslation } from "../translator/index.js";

/** What the adapter needs from the Oracle. The real value is `import * as oracle from "../oracle/index.js"`. */
export interface OracleBackend {
  compileCobol(source: string, config?: PartialOracleConfig): Promise<CompiledHandle | RunResult>;
  runCompiled(
    handle: CompiledHandle,
    inputLines: readonly string[],
    opts?: { runTimeoutMs?: number },
  ): Promise<RunResult>;
  releaseHandle(handle: CompiledHandle): Promise<void>;
  isCompiledHandle(value: unknown): value is CompiledHandle;
  shutdown(): Promise<void>;
}

export interface ServerConfig {
  readonly port: number;
  /** Default 1000. */
  readonly defaultCaseCount: number;
  /** Default 2000. */
  readonly maxCaseCount: number;
  /** Default 60000. */
  readonly timeBudgetMs: number;
  /** Default $HOME/work. */
  readonly workRoot: string;
}

/** Timings that are not environment variables. Tests shrink them to milliseconds. */
export interface Timings {
  /** 5000: abort at budget + grace. */
  readonly abortBackstopGraceMs: number;
  /** 5000: wait after abort before the timeout error. */
  readonly engineExitGraceMs: number;
  /** 15000. */
  readonly probeTimeoutMs: number;
  /** 2000 in production, 0 in tests. */
  readonly probeMinIntervalMs: number;
  /** 5000. */
  readonly shutdownDeadlineMs: number;
}

/** Line sink for server logs. Tests capture it. */
export interface ServerLogger {
  line(text: string): void;
}

export interface AppDeps {
  readonly config: ServerConfig;
  readonly timings: Timings;
  /** Real oracle or a fake. */
  readonly backend: OracleBackend;
  /** Real Engine or a throwing fake. */
  readonly engine: typeof runEquivalence;
  readonly catalog: { getSample: typeof getSample; getTranslation: typeof getTranslation };
  /** realpath-able directory. */
  readonly staticRoot: string;
  /** Real: single execFile. Test: constant. */
  readonly cobcVersion: () => Promise<string | null>;
  readonly logger: ServerLogger;
  /** Uptime clock. */
  readonly now: () => number;
}

export type { OraclePort };
