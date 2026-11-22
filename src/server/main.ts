import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runEquivalence } from "../equivalence/index.js";
import * as oracle from "../oracle/index.js";
import { getSample, getTranslation } from "../translator/index.js";
import { createApp, type App } from "./app.js";
import { createCobcVersionCache, type ExecFileFn } from "./cobc-version.js";
import { loadServerConfig, ServerConfigError } from "./config.js";
import type { AppDeps, OracleBackend, ServerLogger, Timings } from "./types.js";
import { prepareWorkRoot, realWorkdirFs } from "./workdir.js";

const LISTEN_HOST = "0.0.0.0";

const TIMINGS: Timings = Object.freeze({
  abortBackstopGraceMs: 5000,
  engineExitGraceMs: 5000,
  probeTimeoutMs: 15000,
  probeMinIntervalMs: 2000,
  shutdownDeadlineMs: 5000,
});

const logger: ServerLogger = {
  line: (text: string): void => {
    process.stdout.write(`${text}\n`);
  },
};

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "unknown error";
}

function fatal(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function installSignalHandlers(app: App, deadlineMs: number): void {
  let started = false;
  const onSignal = (): void => {
    if (started) return;
    started = true;
    const hardTimer = setTimeout(() => {
      process.exit(1);
    }, deadlineMs);
    hardTimer.unref();
    app
      .shutdown()
      .catch(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

function listen(app: App, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, LISTEN_HOST, () => {
      app.server.off("error", reject);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  let config;
  try {
    config = loadServerConfig(process.env);
  } catch (err) {
    fatal(err instanceof ServerConfigError ? err.message : `invalid configuration: ${describeError(err)}`);
  }

  let execAllowed: boolean;
  try {
    ({ execAllowed } = await prepareWorkRoot(config.workRoot, realWorkdirFs, logger));
  } catch (err) {
    fatal(describeError(err));
  }

  const cobcVersion = createCobcVersionCache(execFile as unknown as ExecFileFn);
  const backend: OracleBackend = oracle;
  const deps: AppDeps = {
    config,
    timings: TIMINGS,
    backend,
    engine: runEquivalence,
    catalog: { getSample, getTranslation },
    staticRoot: fileURLToPath(new URL("../../public", import.meta.url)),
    cobcVersion: cobcVersion.get,
    logger,
    now: () => Math.round(performance.now()),
    execAllowed,
  };
  const app = createApp(deps);
  installSignalHandlers(app, TIMINGS.shutdownDeadlineMs);

  try {
    await listen(app, config.port);
  } catch (err) {
    fatal(`cannot listen on port ${String(config.port)}: ${describeError(err)}`);
  }
  logger.line(
    `listening PORT=${String(config.port)} defaultCaseCount=${String(config.defaultCaseCount)} ` +
      `maxCaseCount=${String(config.maxCaseCount)} timeBudgetMs=${String(config.timeBudgetMs)}`,
  );

  cobcVersion.start();
  void app.probe.run({ force: true }).catch(() => undefined);
}

main().catch((err: unknown) => {
  fatal(describeError(err));
});
