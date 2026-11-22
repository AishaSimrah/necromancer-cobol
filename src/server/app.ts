import http from "node:http";
import { createOracleAdapter, type OracleAdapter } from "./oracle-adapter.js";
import { createProbe, type ProbeController } from "./probe.js";
import { createHandler, type AppState } from "./routes.js";
import type { AppDeps } from "./types.js";

export interface App {
  readonly server: http.Server;
  /** Idempotent. Resolves when the server is closed and the Oracle is shut down. */
  readonly shutdown: () => Promise<void>;
  readonly state: AppState;
  readonly probe: ProbeController;
  readonly adapter: OracleAdapter;
}

const MAX_HEADER_SIZE = 8192;
const HEADERS_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 30_000;
const KEEP_ALIVE_TIMEOUT_MS = 65_000;
const MAX_CONNECTIONS = 64;

function configureServer(server: http.Server): void {
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxConnections = MAX_CONNECTIONS;
}

/** No `process.*` access: everything with a side effect comes from `deps`. */
export function createApp(deps: AppDeps): App {
  const state: AppState = { shuttingDown: false };
  const adapter = createOracleAdapter({ backend: deps.backend, workRoot: deps.config.workRoot });
  // The Run_Slot belongs to the prove runner (added later); until then no run can be active.
  const slot = { isTaken: (): boolean => false };
  const probe = createProbe({
    adapter,
    getSample: deps.catalog.getSample,
    slot,
    timings: deps.timings,
    logger: deps.logger,
    execAllowed: deps.execAllowed ?? true,
    now: deps.now,
  });

  const server = http.createServer({ maxHeaderSize: MAX_HEADER_SIZE }, createHandler({ deps, probe, state }));
  configureServer(server);

  let shutdownPromise: Promise<void> | null = null;

  const doShutdown = async (): Promise<void> => {
    state.shuttingDown = true;
    const closed = new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    server.closeIdleConnections();
    try {
      await deps.backend.shutdown();
    } catch {
      deps.logger.line("oracle shutdown failed");
    }
    server.closeAllConnections();
    await closed;
  };

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= doShutdown();
    return shutdownPromise;
  };

  return { server, shutdown, state, probe, adapter };
}
