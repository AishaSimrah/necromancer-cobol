import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEquivalence } from "../../src/equivalence/index.js";
import type { EquivalenceOptions } from "../../src/equivalence/index.js";
import type { CompiledHandle, RunResult } from "../../src/oracle/index.js";
import { createApp, type App } from "../../src/server/app.js";
import type { AppDeps, OracleBackend, Timings } from "../../src/server/types.js";
import { getSample, getTranslation } from "../../src/translator/index.js";
import { SAMPLE_IDS } from "../../src/translator/types.js";
import type { SampleId } from "../../src/translator/types.js";

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** Fake Oracle backend. Plays GnuCOBOL by running the catalog's `correct` translation. No Docker. */
interface Fake {
  backend: OracleBackend;
  readonly live: Set<CompiledHandle>;
  readonly handles: Map<CompiledHandle, SampleId>;
  compiles: number;
  runCalls: number;
  runDelayMs: number;
}

function failure(status: RunResult["status"]): RunResult {
  return { status, stdout: "", stderr: "", exitCode: null, truncated: false, durationMs: 0, message: "fake failure" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFake(): Fake {
  const fake: Fake = {
    live: new Set(),
    handles: new Map(),
    compiles: 0,
    runCalls: 0,
    runDelayMs: 0,
    backend: undefined as unknown as OracleBackend,
  };
  fake.backend = {
    compileCobol: (source) => {
      const id = SAMPLE_IDS.find((s) => getSample(s).cobolSource === source);
      if (id === undefined) return Promise.resolve(failure("compile_error"));
      fake.compiles += 1;
      const handle = { id: `fake-${String(fake.compiles)}` } as unknown as CompiledHandle;
      fake.handles.set(handle, id);
      fake.live.add(handle);
      return Promise.resolve(handle);
    },
    runCompiled: async (handle, inputLines) => {
      fake.runCalls += 1;
      if (fake.runDelayMs > 0) await sleep(fake.runDelayMs);
      const id = fake.handles.get(handle);
      if (id === undefined) return failure("timeout");
      const stdout = await getTranslation(id, "correct").candidate([...inputLines]);
      return { status: "ok", stdout, stderr: "", exitCode: 0, truncated: false, durationMs: 0 };
    },
    releaseHandle: (handle) => {
      fake.live.delete(handle);
      return Promise.resolve();
    },
    isCompiledHandle: (value: unknown): value is CompiledHandle => fake.handles.has(value as CompiledHandle),
    shutdown: () => Promise.resolve(),
  };
  return fake;
}

interface Harness {
  readonly app: App;
  readonly port: number;
  readonly fake: Fake;
  readonly dir: string;
  /** Options the server passed to the Engine, one entry per run. */
  readonly engineOptions: EquivalenceOptions[];
}

interface HarnessOptions {
  readonly timeBudgetMs?: number;
  readonly defaultCaseCount?: number;
  readonly maxCaseCount?: number;
}

const TIMINGS: Timings = {
  abortBackstopGraceMs: 500,
  engineExitGraceMs: 500,
  probeTimeoutMs: 2000,
  probeMinIntervalMs: 0,
  shutdownDeadlineMs: 500,
};

function makeDeps(dir: string, fake: Fake, options: HarnessOptions, seen: EquivalenceOptions[]): AppDeps {
  const engine = ((opts: EquivalenceOptions) => {
    seen.push(opts);
    return runEquivalence(opts);
  }) as typeof runEquivalence;
  return {
    config: {
      port: 0,
      defaultCaseCount: options.defaultCaseCount ?? 1000,
      maxCaseCount: options.maxCaseCount ?? 100_000,
      timeBudgetMs: options.timeBudgetMs ?? 60_000,
      workRoot: path.join(os.tmpdir(), "necro-budget-work"),
    },
    timings: TIMINGS,
    backend: fake.backend,
    engine,
    catalog: { getSample, getTranslation },
    staticRoot: dir,
    cobcVersion: () => Promise.resolve("3.1.2.0"),
    logger: { line: () => undefined },
    now: () => Date.now(),
    execAllowed: true,
  };
}

function listen(app: App): Promise<number> {
  return new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", () => {
      resolve((app.server.address() as AddressInfo).port);
    });
  });
}

function request(port: number, method: string, requestPath: string, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Connection: "close" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const req = http.request({ host: "127.0.0.1", port, method, path: requestPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

function prove(port: number, extra: Record<string, unknown> = {}): Promise<Reply> {
  const body = { sampleId: "interest", variant: "correct", ...extra };
  return request(port, "POST", "/api/prove", JSON.stringify(body));
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function lastEvent(body: string): Record<string, unknown> {
  const all = body
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  return all[all.length - 1] as Record<string, unknown>;
}

describe("time budget, abort and case count limits", () => {
  let harness: Harness | null = null;

  async function start(options: HarnessOptions = {}): Promise<Harness> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "necro-budget-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    const fake = createFake();
    const engineOptions: EquivalenceOptions[] = [];
    const app = createApp(makeDeps(dir, fake, options, engineOptions));
    const port = await listen(app);
    harness = { app, port, fake, dir, engineOptions };
    const warm = await request(port, "GET", "/api/health?probe=1");
    expect(JSON.parse(warm.body)).toMatchObject({ oracle: "ready" });
    fake.compiles = 0;
    fake.runCalls = 0;
    return harness;
  }

  beforeEach(() => {
    harness = null;
  });

  afterEach(async () => {
    if (harness === null) return;
    const h = harness;
    harness = null;
    await h.app.shutdown();
    await rm(h.dir, { recursive: true, force: true });
  });

  describe("time budget", () => {
    it("passes the configured timeBudgetMs to the Engine", { timeout: 60_000 }, async () => {
      const h = await start({ timeBudgetMs: 12_345 });
      const reply = await prove(h.port, { caseCount: 100 });
      expect(reply.status).toBe(200);
      expect(h.engineOptions).toHaveLength(1);
      expect(h.engineOptions[0]?.timeBudgetMs).toBe(12_345);
    });

    it("a normal run reports complete: true with neither flag set", { timeout: 60_000 }, async () => {
      const h = await start();
      const reply = await prove(h.port, { caseCount: 100 });
      const report = lastEvent(reply.body);
      expect(report["type"]).toBe("report");
      expect(report["complete"]).toBe(true);
      expect(report["budgetReached"]).toBe(false);
      expect(report["aborted"]).toBe(false);
    });

    it("a run ended by the budget is incomplete and scores only the cases that ran", { timeout: 60_000 }, async () => {
      const h = await start({ timeBudgetMs: 800 });
      h.fake.runDelayMs = 20;
      const reply = await prove(h.port, { caseCount: 2000 });
      expect(reply.status).toBe(200);
      const report = lastEvent(reply.body);
      expect(report["type"], reply.body.slice(-300)).toBe("report");
      expect(report["complete"]).toBe(false);
      expect(report["budgetReached"]).toBe(true);
      expect(report["aborted"]).toBe(false);
      const casesRun = report["casesRun"] as number;
      expect(casesRun).toBeGreaterThan(0);
      expect(casesRun).toBeLessThan(2000);
      // The correct variant matches everywhere, so the partial score is over the cases that ran.
      expect(report["mismatchCount"]).toBe(0);
      expect(report["matchedCount"]).toBe(report["conclusiveCount"]);
      expect(report["matchedCount"] as number).toBeLessThanOrEqual(casesRun);
      expect(report["matchScore"]).toBe(1);
    });

    it("a run ended by abort (shutdown) is incomplete with aborted true and a partial score", { timeout: 60_000 }, async () => {
      const h = await start();
      h.fake.runDelayMs = 5;
      const inflight = prove(h.port, { caseCount: 2000 });
      await waitUntil(() => h.fake.runCalls >= 3, "run to start");
      await h.app.shutdown();
      const reply = await inflight;
      expect(reply.status).toBe(200);
      const report = lastEvent(reply.body);
      expect(report["type"]).toBe("report");
      expect(report["complete"]).toBe(false);
      expect(report["aborted"]).toBe(true);
      expect(report["casesRun"] as number).toBeLessThan(2000);
      expect(report["mismatchCount"]).toBe(0);
      expect(report["matchedCount"]).toBe(report["conclusiveCount"]);
    });
  });

  describe("case count limits", () => {
    it("applies the configured default when caseCount is absent", { timeout: 60_000 }, async () => {
      const h = await start({ defaultCaseCount: 150, maxCaseCount: 300 });
      const reply = await prove(h.port);
      expect(reply.status).toBe(200);
      expect(h.engineOptions[0]?.caseCount).toBe(150);
      const report = lastEvent(reply.body);
      expect(report["caseCount"]).toBe(150);
      expect(report["complete"]).toBe(true);
    });

    it("accepts the configured maximum", { timeout: 60_000 }, async () => {
      const h = await start({ defaultCaseCount: 150, maxCaseCount: 300 });
      const reply = await prove(h.port, { caseCount: 300 });
      expect(reply.status).toBe(200);
      expect(h.engineOptions[0]?.caseCount).toBe(300);
    });

    it("rejects a caseCount above the configured maximum and states the range in force", { timeout: 60_000 }, async () => {
      const h = await start({ defaultCaseCount: 150, maxCaseCount: 300 });
      const reply = await prove(h.port, { caseCount: 301 });
      expect(reply.status).toBe(400);
      const body = JSON.parse(reply.body) as Record<string, unknown>;
      expect(body["type"]).toBe("error");
      expect(body["code"]).toBe("invalid_case_count");
      expect(body["message"]).toBe("caseCount must be an integer from 100 to 300.");
      expect(h.engineOptions).toHaveLength(0);
      expect(h.fake.compiles).toBe(0);
    });

    it("the range in the message follows the configured maximum", { timeout: 60_000 }, async () => {
      const h = await start({ defaultCaseCount: 200, maxCaseCount: 500 });
      const reply = await prove(h.port, { caseCount: 501 });
      expect(reply.status).toBe(400);
      expect((JSON.parse(reply.body) as Record<string, unknown>)["message"]).toBe(
        "caseCount must be an integer from 100 to 500.",
      );
    });

    it("rejects a caseCount below the minimum of 100", { timeout: 60_000 }, async () => {
      const h = await start({ defaultCaseCount: 150, maxCaseCount: 300 });
      const reply = await prove(h.port, { caseCount: 99 });
      expect(reply.status).toBe(400);
      expect(JSON.parse(reply.body)).toMatchObject({ code: "invalid_case_count" });
    });
  });
});
