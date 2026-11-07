/**
 * Oracle configuration, defaults and merge helper.
 * Phase A code reads only the size, timeout, output and image fields.
 * Tasks 5.4 and 5.5 start using the sandbox fields.
 */

export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface ResourceLimits {
  /** RLIMIT_AS */
  readonly memoryBytes: number;
  /** RLIMIT_CPU soft; hard = soft + 1 */
  readonly cpuSeconds: number;
  /** RLIMIT_NPROC (per slot uid) */
  readonly maxProcesses: number;
  /** RLIMIT_FSIZE */
  readonly maxFileBytes: number;
}

export interface SandboxPolicy {
  /** Fixed environment allowlist. HOME is set by the Worker to the slot scratch dir. */
  readonly env: Readonly<Record<string, string>>;
  /** Slot n runs as uidBase + n, never 0. */
  readonly uidBase: number;
  /** Group oracle-run. */
  readonly gid: number;
  readonly run: ResourceLimits;
  readonly compile: ResourceLimits;
  readonly networkDisabled: boolean;
}

export interface OracleConfig {
  sourceSizeLimitBytes: number;
  inputSizeLimitBytes: number;
  compileTimeoutMs: number;
  defaultRunTimeoutMs: number;
  maxRunTimeoutMs: number;
  outputLimitBytes: number;
  expectedCobcVersion: string;
  imageName: string;
  workerConcurrency: number;
  workerCommand: readonly string[];
  sandbox: SandboxPolicy;
}

export type PartialOracleConfig = Partial<Omit<OracleConfig, "sandbox">> & {
  sandbox?: Partial<Omit<SandboxPolicy, "run" | "compile" | "env">> & {
    env?: Readonly<Record<string, string>>;
    run?: Partial<ResourceLimits>;
    compile?: Partial<ResourceLimits>;
  };
};

const MIB = 1024 * 1024;

export const DEFAULT_CONFIG: OracleConfig = Object.freeze({
  sourceSizeLimitBytes: 65536,
  inputSizeLimitBytes: 65536,
  compileTimeoutMs: 30_000,
  defaultRunTimeoutMs: 5_000,
  maxRunTimeoutMs: 60_000,
  outputLimitBytes: 1 * MIB,
  expectedCobcVersion: "3.1.2",
  imageName: "necromancer-oracle",
  workerConcurrency: 8,
  workerCommand: Object.freeze(["node", "/opt/oracle/worker.js"]),
  sandbox: Object.freeze({
    env: Object.freeze({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      TZ: "UTC",
    }),
    uidBase: 20000,
    gid: 20000,
    run: Object.freeze({
      memoryBytes: 256 * MIB,
      cpuSeconds: 10,
      maxProcesses: 16,
      maxFileBytes: 10 * MIB,
    }),
    compile: Object.freeze({
      memoryBytes: 1024 * MIB,
      cpuSeconds: 30,
      maxProcesses: 64,
      maxFileBytes: 64 * MIB,
    }),
    networkDisabled: true,
  }),
});

/** Merges a partial override over the defaults. Nested sandbox objects are merged, not replaced. */
export function mergeConfig(override?: PartialOracleConfig): OracleConfig {
  const base = DEFAULT_CONFIG;
  if (override === undefined) return base;
  const { sandbox: sb, ...top } = override;
  const definedTop = Object.fromEntries(
    Object.entries(top).filter(([, v]) => v !== undefined),
  ) as Partial<Omit<OracleConfig, "sandbox">>;
  return {
    ...base,
    ...definedTop,
    sandbox: {
      ...base.sandbox,
      ...(sb?.uidBase !== undefined ? { uidBase: sb.uidBase } : {}),
      ...(sb?.gid !== undefined ? { gid: sb.gid } : {}),
      ...(sb?.networkDisabled !== undefined ? { networkDisabled: sb.networkDisabled } : {}),
      env: { ...base.sandbox.env, ...sb?.env },
      run: { ...base.sandbox.run, ...sb?.run },
      compile: { ...base.sandbox.compile, ...sb?.compile },
    },
  };
}
