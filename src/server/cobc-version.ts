/**
 * cobc version lookup. One fixed `execFile("cobc", ["--version"])` call per
 * process, cached, never repeated. The exec function is injected so tests can
 * fake it; main.ts passes `node:child_process`'s `execFile`.
 */

const VERSION_PATTERN = /^cobc \(GnuCOBOL\) (\d+\.\d+\.\d+(?:\.\d+)?)/;

/** Maximum time a health request waits for an in-flight version call. */
export const COBC_VERSION_WAIT_MS = 1000;

export interface CobcExecOptions {
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly shell: false;
  readonly windowsHide: true;
}

/** The subset of `child_process.execFile` used here (callback form). */
export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: CobcExecOptions,
  callback: (error: Error | null, stdout: string | Buffer) => void,
) => unknown;

const EXEC_OPTIONS: CobcExecOptions = Object.freeze({
  timeout: 5000,
  maxBuffer: 16 * 1024,
  shell: false,
  windowsHide: true,
});

/** Returns the version from the first line of `cobc --version`, else null. */
export function parseCobcVersion(stdout: string): string | null {
  const firstLine = stdout.split(/\r?\n/, 1)[0] ?? "";
  const match = VERSION_PATTERN.exec(firstLine);
  return match?.[1] ?? null;
}

/** Runs `cobc --version` once. Resolves to the version, or null on any failure. */
export function readCobcVersion(execFile: ExecFileFn): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    try {
      execFile("cobc", ["--version"], EXEC_OPTIONS, (error, stdout) => {
        resolve(error ? null : parseCobcVersion(String(stdout)));
      });
    } catch {
      resolve(null);
    }
  });
}

export interface CobcVersionCache {
  /** Starts the single call if not started yet. Safe to call repeatedly. */
  readonly start: () => void;
  /** Cached value if settled, else waits at most `waitMs` for the call, then null. */
  readonly get: () => Promise<string | null>;
}

export function createCobcVersionCache(
  execFile: ExecFileFn,
  waitMs: number = COBC_VERSION_WAIT_MS,
): CobcVersionCache {
  let inFlight: Promise<string | null> | null = null;
  let settled = false;
  let value: string | null = null;

  const start = (): void => {
    if (inFlight !== null) return;
    inFlight = readCobcVersion(execFile).then((version) => {
      value = version;
      settled = true;
      return version;
    });
  };

  const get = async (): Promise<string | null> => {
    start();
    if (settled) return value;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    });
    try {
      return await Promise.race([inFlight as Promise<string | null>, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  return { start, get };
}
