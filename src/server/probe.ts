import type { getSample } from "../translator/index.js";
import type { OracleAdapter } from "./oracle-adapter.js";
import type { ServerLogger, Timings } from "./types.js";

export type OracleState = "ready" | "unavailable";

export interface ProbeController {
  readonly state: () => OracleState;
  /** Single-flight. Returns the last state when a Prove_Run is active. */
  readonly run: (opts?: { force?: boolean }) => Promise<OracleState>;
  readonly markUnavailable: () => void;
}

export interface ProbeDeps {
  readonly adapter: OracleAdapter;
  readonly getSample: typeof getSample;
  readonly slot: { readonly isTaken: () => boolean };
  readonly timings: Pick<Timings, "probeTimeoutMs" | "probeMinIntervalMs">;
  readonly logger: ServerLogger;
  /** False when the Work_Root cannot execute files (from prepareWorkRoot). */
  readonly execAllowed: boolean;
  readonly now: () => number;
}

const TIMEOUT = Symbol("probe-timeout");

class ProbeFailure extends Error {}

/** One real compile + run of the interest sample. Resolves true only on an exact match. */
async function realProbe(deps: ProbeDeps): Promise<boolean> {
  const { adapter } = deps;
  const sample = deps.getSample("interest");
  const example = sample.examples[0];
  if (example === undefined) throw new ProbeFailure("no example");
  const compiled = await adapter.compile(sample.cobolSource);
  if (!adapter.backend.isCompiledHandle(compiled)) return false;
  try {
    const result = await adapter.backend.runCompiled(compiled, example.input);
    return result.status === "ok" && result.stdout === example.output;
  } finally {
    await adapter.backend.releaseHandle(compiled).catch(() => undefined);
  }
}

function withTimeout(work: Promise<boolean>, ms: number): Promise<boolean | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export function createProbe(deps: ProbeDeps): ProbeController {
  let current: OracleState = "unavailable";
  let inFlight: Promise<OracleState> | null = null;
  let finishedAt: number | null = null;

  const safeReset = async (): Promise<void> => {
    try {
      await deps.adapter.reset();
    } catch {
      deps.logger.line("probe: oracle reset failed");
    }
  };

  const execute = async (): Promise<OracleState> => {
    let ok = false;
    let reason = "probe failed";
    const work = realProbe(deps);
    // A late rejection after a timeout must not become an unhandled rejection.
    work.catch(() => undefined);
    try {
      const outcome = await withTimeout(work, deps.timings.probeTimeoutMs);
      if (outcome === TIMEOUT) reason = "probe timed out";
      else if (outcome) ok = true;
      else reason = "probe output mismatch";
    } catch {
      reason = "probe error";
    }
    if (!ok) {
      deps.logger.line(`oracle unavailable: ${reason}`);
      await safeReset();
    }
    current = ok ? "ready" : "unavailable";
    finishedAt = deps.now();
    return current;
  };

  const run = (opts?: { force?: boolean }): Promise<OracleState> => {
    if (!deps.execAllowed) {
      current = "unavailable";
      return Promise.resolve(current);
    }
    if (inFlight !== null) return inFlight;
    if (deps.slot.isTaken()) return Promise.resolve(current);
    if (opts?.force !== true && current === "ready") return Promise.resolve(current);
    if (finishedAt !== null && deps.now() - finishedAt < deps.timings.probeMinIntervalMs) {
      return Promise.resolve(current);
    }
    const started = execute().finally(() => {
      inFlight = null;
    });
    inFlight = started;
    return started;
  };

  return {
    state: () => current,
    run,
    markUnavailable: () => {
      current = "unavailable";
      finishedAt = null;
    },
  };
}
