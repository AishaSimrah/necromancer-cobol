import type { ServerResponse } from "node:http";
import { EquivalenceConfigError } from "../equivalence/index.js";
import type { EquivalenceOptions, OraclePort } from "../equivalence/index.js";
import type { runEquivalence } from "../equivalence/index.js";
import type { getSample, getTranslation } from "../translator/index.js";
import { errorBody, FIXED_MESSAGES, statusOf } from "./errors.js";
import { toEngineErrorWire, toProgressWire, toReportWire } from "./mappers.js";
import type { ProbeController } from "./probe.js";
import type { OracleAdapter } from "./oracle-adapter.js";
import type { ServerConfig, ServerLogger, Timings } from "./types.js";
import type { ErrorWire, ProgressWire, ProveRequest, ReportWire } from "./wire.js";

export interface RunSlot {
  /** Synchronous: returns true and takes the slot, or returns false. */
  readonly tryTake: () => boolean;
  /** Like `tryTake`, but returns the per-run token that `release` needs. */
  readonly acquire: () => symbol | null;
  /** Idempotent per take. With a token, frees the slot only if the token is current. */
  readonly release: (token?: symbol) => void;
  readonly isTaken: () => boolean;
}

export function createRunSlot(): RunSlot {
  let current: symbol | null = null;
  const acquire = (): symbol | null => {
    if (current !== null) return null;
    current = Symbol("prove-run");
    return current;
  };
  return {
    acquire,
    tryTake: () => acquire() !== null,
    release: (token) => {
      if (token === undefined || token === current) current = null;
    },
    isTaken: () => current !== null,
  };
}

export interface NdjsonWriter {
  /** Returns a promise only when backpressure applies. */
  progress(e: ProgressWire): void | Promise<void>;
  /** Writes once, then closes the writer. */
  final(e: ReportWire | ErrorWire): void;
  /** Ends the response once. */
  end(): void;
  /** Called when the client is gone. */
  markClientGone(): void;
  readonly isClosed: () => boolean;
}

export function createNdjsonWriter(res: ServerResponse): NdjsonWriter {
  let closed = false;
  let clientGone = false;
  let ended = false;

  const write = (event: ProgressWire | ReportWire | ErrorWire): boolean => {
    if (closed || clientGone) return true;
    return res.write(`${JSON.stringify(event)}\n`);
  };

  return {
    progress(e) {
      if (closed || clientGone) return undefined;
      if (write(e)) return undefined;
      return new Promise<void>((resolve) => {
        const done = (): void => {
          res.off("drain", done);
          res.off("close", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
      });
    },
    final(e) {
      if (closed || clientGone) return;
      closed = true;
      res.write(`${JSON.stringify(e)}\n`);
    },
    end() {
      closed = true;
      if (ended) return;
      ended = true;
      res.end();
    },
    markClientGone() {
      clientGone = true;
    },
    isClosed: () => closed,
  };
}

export interface ProveRunnerDeps {
  readonly config: Pick<ServerConfig, "timeBudgetMs">;
  readonly timings: Pick<Timings, "abortBackstopGraceMs" | "engineExitGraceMs">;
  /** Only `reset` is used: it stops a stuck Worker after the exit watchdog fires. */
  readonly adapter: Pick<OracleAdapter, "reset">;
  readonly engine: typeof runEquivalence;
  readonly catalog: { getSample: typeof getSample; getTranslation: typeof getTranslation };
  readonly probe: ProbeController;
  readonly port: OraclePort;
  readonly slot: RunSlot;
  readonly logger: ServerLogger;
}

export interface ProveRunner {
  /** Handles a validated request on `res`. Never throws. */
  readonly handle: (req: ProveRequest, res: ServerResponse) => Promise<void>;
  readonly abortActive: () => void;
  /** Resolves when no run is active. */
  readonly idle: () => Promise<void>;
}

export function createProveRunner(deps: ProveRunnerDeps): ProveRunner {
  const { slot, probe, logger } = deps;
  let active: AbortController | null = null;
  let idleWaiters: Array<() => void> = [];

  const notifyIdle = (): void => {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };

  const sendBusy = (res: ServerResponse): void => {
    res.writeHead(statusOf("busy"), {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "5",
    });
    res.end(JSON.stringify(errorBody("busy", FIXED_MESSAGES.busy)));
  };

  const runEngine = async (
    req: ProveRequest,
    writer: NdjsonWriter,
    signal: AbortSignal,
  ): Promise<void> => {
    try {
      const sample = deps.catalog.getSample(req.sampleId);
      const translation = deps.catalog.getTranslation(req.sampleId, req.variant);
      const options: EquivalenceOptions = {
        source: sample.cobolSource,
        fields: sample.fields,
        candidate: translation.candidate,
        caseCount: req.caseCount,
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        timeBudgetMs: deps.config.timeBudgetMs,
        signal,
        onProgress: (e) => writer.progress(toProgressWire(e)),
        oracle: deps.port,
      };
      const report = await deps.engine(options);
      if (report.outcome === "completed" && report.matchScore !== undefined) {
        writer.final(toReportWire(report, req));
      } else if (report.outcome === "completed") {
        writer.final(errorBody("internal_error", FIXED_MESSAGES.internal_error));
      } else {
        if (report.outcome === "oracle_unavailable") probe.markUnavailable();
        writer.final(toEngineErrorWire(report));
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      logger.line(`prove: engine failed: ${detail}`);
      if (cause instanceof EquivalenceConfigError) {
        writer.final(errorBody("engine_config", FIXED_MESSAGES.engine_config));
      } else {
        writer.final(errorBody("internal_error", FIXED_MESSAGES.internal_error));
      }
    }
  };

  const handle = async (req: ProveRequest, res: ServerResponse): Promise<void> => {
    const token = slot.acquire();
    if (token === null) {
      sendBusy(res);
      return;
    }
    const writer = createNdjsonWriter(res);
    const ac = new AbortController();
    active = ac;
    const onGone = (): void => {
      if (res.writableEnded) return;
      writer.markClientGone();
      ac.abort();
    };
    res.on("close", onGone);
    let backstop: NodeJS.Timeout | undefined;
    let watchdog: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      watchdog = setTimeout(fireWatchdog, deps.timings.engineExitGraceMs);
    };
    let resolveWatchdog: () => void = () => undefined;
    const watchdogFired = new Promise<void>((resolve) => {
      resolveWatchdog = resolve;
    });
    const fireWatchdog = (): void => {
      logger.line("prove: engine did not exit after abort; resetting oracle");
      writer.final(errorBody("timeout", FIXED_MESSAGES.timeout));
      probe.markUnavailable();
      deps.adapter.reset().catch((cause: unknown) => {
        logger.line(`prove: oracle reset failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      });
      resolveWatchdog();
    };
    ac.signal.addEventListener("abort", onAbort, { once: true });
    try {
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      backstop = setTimeout(
        () => ac.abort(),
        deps.config.timeBudgetMs + deps.timings.abortBackstopGraceMs,
      );
      await Promise.race([runEngine(req, writer, ac.signal), watchdogFired]);
    } catch (cause) {
      logger.line(`prove: ${cause instanceof Error ? cause.message : String(cause)}`);
      writer.final(errorBody("internal_error", FIXED_MESSAGES.internal_error));
    } finally {
      clearTimeout(backstop);
      clearTimeout(watchdog);
      ac.signal.removeEventListener("abort", onAbort);
      res.off("close", onGone);
      writer.end();
      if (active === ac) active = null;
      slot.release(token);
      if (!slot.isTaken()) notifyIdle();
    }
  };

  return {
    handle,
    abortActive: () => {
      active?.abort();
    },
    idle: () =>
      slot.isTaken()
        ? new Promise<void>((resolve) => {
            idleWaiters.push(resolve);
          })
        : Promise.resolve(),
  };
}
