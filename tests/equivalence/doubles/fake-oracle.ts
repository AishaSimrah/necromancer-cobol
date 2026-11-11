import type { CompiledHandle, OraclePort, RunResult } from "../../../src/equivalence/oracle-port.js";

/** One entry of the call-order log. */
export type FakeOracleCall =
  | { readonly kind: "compileCobol"; readonly source: string }
  | {
      readonly kind: "runCompiled";
      readonly handleId: string;
      readonly inputLines: readonly string[];
    }
  | { readonly kind: "releaseHandle"; readonly handleId: string };

export type FakeOracleCallKind = FakeOracleCall["kind"];

export interface RunContext {
  readonly handle: CompiledHandle;
  readonly inputLines: readonly string[];
  /** Zero-based index of this runCompiled call. */
  readonly callIndex: number;
}

/** A scripted run result: a fixed value or a function of the call. */
export type RunScript = RunResult | ((ctx: RunContext) => RunResult);

export interface FakeOracleOptions {
  /**
   * Per-call run results. A list is consumed in order, the last entry repeats.
   * A function is called for every runCompiled call. Default: ok with stdout "".
   */
  readonly run?: RunScript | readonly RunScript[];
  /** Result of compileCobol: a handle id is generated when absent. A RunResult makes compile fail. */
  readonly compileResult?: RunResult | ((source: string) => RunResult | undefined);
  /** Throw this error from compileCobol. */
  readonly throwOnCompile?: Error;
  /** Throw from runCompiled when the predicate returns true for the zero-based call index. */
  readonly throwOnRun?: { readonly error: Error; readonly when: (callIndex: number) => boolean };
  /** Throw this error from releaseHandle (after the call is counted and logged). */
  readonly throwOnRelease?: Error;
  /** Delay in ms applied before each call resolves. */
  readonly delayMs?: { readonly compile?: number; readonly run?: number; readonly release?: number };
}

export interface FakeOracle extends OraclePort {
  readonly compileCalls: number;
  readonly runCalls: number;
  readonly releaseCalls: number;
  readonly totalCalls: number;
  /** Copy of the call-order log. */
  readonly callLog: readonly FakeOracleCall[];
  /** Kinds only, in call order. */
  readonly callOrder: readonly FakeOracleCallKind[];
  /** Ids of handles created and not yet released. */
  readonly liveHandleIds: readonly string[];
  reset(): void;
}

/** Builds a RunResult with status "ok". */
export function okResult(stdout: string, overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: "ok",
    stdout,
    stderr: "",
    exitCode: 0,
    truncated: false,
    durationMs: 0,
    ...overrides,
  };
}

/** Builds a non-ok RunResult with a message. */
export function failResult(
  status: Exclude<RunResult["status"], "ok">,
  message = "",
  overrides: Partial<RunResult> = {},
): RunResult {
  return {
    status,
    stdout: "",
    stderr: "",
    exitCode: null,
    truncated: false,
    durationMs: 0,
    message,
    ...overrides,
  };
}

function sleep(ms: number | undefined): Promise<void> {
  if (ms === undefined || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeHandle(id: string): CompiledHandle {
  // The brand is a compile-time-only symbol; a plain object with `id` is a valid handle at runtime.
  return { id } as unknown as CompiledHandle;
}

function isHandle(x: CompiledHandle | RunResult): x is CompiledHandle {
  const candidate = x as { id?: unknown; status?: unknown };
  return typeof candidate.id === "string" && candidate.status === undefined;
}

/** Creates an OraclePort that never touches the real Oracle. */
export function createFakeOracle(options: FakeOracleOptions = {}): FakeOracle {
  let log: FakeOracleCall[] = [];
  let compiles = 0;
  let runs = 0;
  let releases = 0;
  let nextHandle = 0;
  const live = new Set<string>();

  function scriptAt(index: number): RunScript {
    const run = options.run;
    if (run === undefined) return okResult("");
    if (Array.isArray(run)) {
      const list = run as readonly RunScript[];
      if (list.length === 0) return okResult("");
      return list[Math.min(index, list.length - 1)] as RunScript;
    }
    return run as RunScript;
  }

  const oracle: FakeOracle = {
    async compileCobol(source: string): Promise<CompiledHandle | RunResult> {
      compiles += 1;
      log.push({ kind: "compileCobol", source });
      await sleep(options.delayMs?.compile);
      if (options.throwOnCompile) throw options.throwOnCompile;
      const configured = options.compileResult;
      const failure = typeof configured === "function" ? configured(source) : configured;
      if (failure) return failure;
      nextHandle += 1;
      const id = `fake-handle-${nextHandle}`;
      live.add(id);
      return makeHandle(id);
    },

    async runCompiled(
      handle: CompiledHandle,
      inputLines: readonly string[],
    ): Promise<RunResult> {
      const callIndex = runs;
      runs += 1;
      log.push({ kind: "runCompiled", handleId: handle.id, inputLines: [...inputLines] });
      await sleep(options.delayMs?.run);
      const thrower = options.throwOnRun;
      if (thrower && thrower.when(callIndex)) throw thrower.error;
      const script = scriptAt(callIndex);
      return typeof script === "function" ? script({ handle, inputLines, callIndex }) : script;
    },

    async releaseHandle(handle: CompiledHandle): Promise<void> {
      releases += 1;
      log.push({ kind: "releaseHandle", handleId: handle.id });
      await sleep(options.delayMs?.release);
      live.delete(handle.id);
      if (options.throwOnRelease) throw options.throwOnRelease;
    },

    isCompiledHandle: isHandle,

    get compileCalls(): number {
      return compiles;
    },
    get runCalls(): number {
      return runs;
    },
    get releaseCalls(): number {
      return releases;
    },
    get totalCalls(): number {
      return compiles + runs + releases;
    },
    get callLog(): readonly FakeOracleCall[] {
      return [...log];
    },
    get callOrder(): readonly FakeOracleCallKind[] {
      return log.map((c) => c.kind);
    },
    get liveHandleIds(): readonly string[] {
      return [...live];
    },
    reset(): void {
      log = [];
      compiles = 0;
      runs = 0;
      releases = 0;
      nextHandle = 0;
      live.clear();
    },
  };
  return oracle;
}
