import fc from "fast-check";
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
import { createRunSlot } from "../../src/server/prove-runner.js";
import type { AppDeps, OracleBackend, Timings } from "../../src/server/types.js";
import { getSample, getTranslation } from "../../src/translator/index.js";
import { SAMPLE_IDS } from "../../src/translator/types.js";
import type { SampleId } from "../../src/translator/types.js";

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

/** Controllable fake Oracle. Plays GnuCOBOL by running the catalog's `correct` translation. */
interface Fake {
  backend: OracleBackend;
  readonly live: Set<CompiledHandle>;
  readonly handles: Map<CompiledHandle, SampleId>;
  readonly releaseCounts: Map<CompiledHandle, number>;
  compiles: number;
  runCalls: number;
  releases: number;
  shutdowns: number;
  runDelayMs: number;
  runStatus: RunResult["status"];
  gate: Promise<void> | null;
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
    releaseCounts: new Map(),
    compiles: 0,
    runCalls: 0,
    releases: 0,
    shutdowns: 0,
    runDelayMs: 0,
    runStatus: "ok",
    gate: null,
    backend: undefined as unknown as OracleBackend,
  };
  const backend: OracleBackend = {
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
      if (fake.gate !== null) await fake.gate;
      if (fake.runDelayMs > 0) await sleep(fake.runDelayMs);
      const id = fake.handles.get(handle);
      if (id === undefined || fake.runStatus !== "ok") return failure(fake.runStatus === "ok" ? "timeout" : fake.runStatus);
      const stdout = await getTranslation(id, "correct").candidate([...inputLines]);
      return { status: "ok", stdout, stderr: "", exitCode: 0, truncated: false, durationMs: 0 };
    },
    releaseHandle: (handle) => {
      fake.releases += 1;
      fake.releaseCounts.set(handle, (fake.releaseCounts.get(handle) ?? 0) + 1);
      fake.live.delete(handle);
      return Promise.resolve();
    },
    isCompiledHandle: (value: unknown): value is CompiledHandle => fake.handles.has(value as CompiledHandle),
    shutdown: () => {
      fake.shutdowns += 1;
      return Promise.resolve();
    },
  };
  fake.backend = backend;
  return fake;
}

interface Harness {
  readonly app: App;
  readonly port: number;
  readonly fake: Fake;
  readonly dir: string;
}

interface HarnessOptions {
  readonly timeBudgetMs?: number;
  readonly timings?: Partial<Timings>;
  readonly engine?: typeof runEquivalence;
}

const BASE_TIMINGS: Timings = {
  abortBackstopGraceMs: 40,
  engineExitGraceMs: 40,
  probeTimeoutMs: 2000,
  probeMinIntervalMs: 0,
  shutdownDeadlineMs: 500,
};

function makeDeps(dir: string, fake: Fake, options: HarnessOptions): AppDeps {
  return {
    config: {
      port: 0,
      defaultCaseCount: 1000,
      maxCaseCount: 100_000,
      timeBudgetMs: options.timeBudgetMs ?? 60_000,
      workRoot: path.join(os.tmpdir(), "necro-concurrency-work"),
    },
    timings: { ...BASE_TIMINGS, ...options.timings },
    backend: fake.backend,
    engine: options.engine ?? runEquivalence,
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
  const body = { sampleId: "interest", variant: "correct", caseCount: 100, ...extra };
  return request(port, "POST", "/api/prove", JSON.stringify(body));
}

/** Starts a prove request and destroys the socket after the first streamed chunk. */
function proveAndDisconnect(port: number, extra: Record<string, unknown> = {}): Promise<void> {
  const payload = JSON.stringify({ sampleId: "interest", variant: "correct", caseCount: 2000, ...extra });
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/api/prove",
        agent: false,
        headers: { "Content-Type": "application/json", Connection: "close" },
      },
      (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
        res.on("error", () => undefined);
      },
    );
    req.on("error", () => resolve());
    req.on("close", resolve);
    req.end(payload);
    setTimeout(() => reject(new Error("no first chunk")), 10_000).unref();
  });
}

async function waitUntil(predicate: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function lines(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function lastEvent(body: string): Record<string, unknown> {
  const all = lines(body);
  return all[all.length - 1] as Record<string, unknown>;
}

describe("Run_Slot and handle lifecycle", { timeout: 60_000 }, () => {
  let harness: Harness | null = null;

  async function start(options: HarnessOptions = {}): Promise<Harness> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "necro-concurrency-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    const fake = createFake();
    const app = createApp(makeDeps(dir, fake, options));
    const port = await listen(app);
    harness = { app, port, fake, dir };
    const warm = await request(port, "GET", "/api/health?probe=1");
    expect(JSON.parse(warm.body)).toMatchObject({ oracle: "ready" });
    fake.compiles = 0;
    fake.runCalls = 0;
    fake.releases = 0;
    return harness;
  }

  afterEach(async () => {
    if (harness === null) return;
    const h = harness;
    harness = null;
    h.fake.gate = null;
    await h.app.shutdown();
    await rm(h.dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    harness = null;
  });

  /** The slot is free again when a fresh run is accepted (not 429) and completes with a report. */
  async function expectSlotReusable(h: Harness): Promise<void> {
    h.fake.runDelayMs = 0;
    h.fake.runStatus = "ok";
    await waitUntil(() => h.fake.live.size === 0, "all handles released");
    let reply = await prove(h.port);
    for (let i = 0; i < 100 && reply.status === 429; i += 1) {
      await sleep(10);
      reply = await prove(h.port);
    }
    expect(reply.status, reply.body.slice(0, 200)).toBe(200);
    expect(lastEvent(reply.body)["type"]).toBe("report");
  }

  function expectHandlesBalanced(h: Harness): void {
    expect(h.fake.live.size, "no live handles").toBe(0);
    expect(h.fake.releases, "releases equal compiles").toBe(h.fake.compiles);
    for (const [, count] of h.fake.releaseCounts) expect(count, "each handle released exactly once").toBe(1);
  }

  describe("RunSlot token semantics", () => {
    // Feature: necromancer-server, Property 11: Run_Slot is taken and released exactly once on every exit path
    // **Validates: Requirements 9.1, 9.2**
    it("a late or repeated release of an old token never frees a newer run", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 5 }), (repeats) => {
          const slot = createRunSlot();
          const first = slot.acquire();
          expect(first).not.toBeNull();
          expect(slot.acquire(), "second take fails while taken").toBeNull();
          expect(slot.tryTake()).toBe(false);
          slot.release(first as symbol);
          expect(slot.isTaken()).toBe(false);
          const second = slot.acquire();
          expect(second).not.toBeNull();
          for (let i = 0; i < repeats; i += 1) slot.release(first as symbol);
          expect(slot.isTaken(), "old token cannot free the newer run").toBe(true);
          slot.release(second as symbol);
          slot.release(second as symbol);
          expect(slot.isTaken()).toBe(false);
        }),
        { numRuns: 20 },
      );
    });
  });

  // Feature: necromancer-server, Property 11: Run_Slot is taken and released exactly once on every exit path
  // **Validates: Requirements 9.1, 9.2**
  it("answers a second request with 429 and Retry-After while the first run still completes", async () => {
    const h = await start();
    let open: () => void = () => undefined;
    h.fake.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = prove(h.port);
    await waitUntil(() => h.fake.runCalls >= 1, "first run to reach the Oracle");

    const second = await prove(h.port);
    expect(second.status).toBe(429);
    expect(second.headers["retry-after"]).toBe("5");
    expect(JSON.parse(second.body)).toMatchObject({ type: "error", code: "busy" });
    expect(second.body).not.toContain("matchScore");

    open();
    const firstReply = await first;
    expect(firstReply.status).toBe(200);
    const report = lastEvent(firstReply.body);
    expect(report["type"]).toBe("report");
    expect(report["complete"]).toBe(true);
    await expectSlotReusable(h);
  });

  // Feature: necromancer-server, Property 11: Run_Slot is taken and released exactly once on every exit path
  // Feature: necromancer-server, Property 12: Every compiled handle is released
  // **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
  describe("every exit path frees the slot and releases every handle", () => {
    it("report", async () => {
      const h = await start();
      const reply = await prove(h.port);
      expect(lastEvent(reply.body)["type"]).toBe("report");
      expect(h.fake.compiles).toBeGreaterThan(0);
      await expectSlotReusable(h);
      expectHandlesBalanced(h);
    });

    it("inconclusive Engine outcome", async () => {
      const h = await start();
      h.fake.runStatus = "timeout";
      const reply = await prove(h.port);
      expect(lastEvent(reply.body)).toMatchObject({ type: "error", code: "inconclusive" });
      await expectSlotReusable(h);
      expectHandlesBalanced(h);
    });

    it("Engine throw", async () => {
      const throwing = ((): Promise<never> => Promise.reject(new Error("boom"))) as unknown as typeof runEquivalence;
      const h = await start({ engine: throwing });
      const reply = await prove(h.port);
      expect(lastEvent(reply.body)).toMatchObject({ type: "error", code: "internal_error" });
      const recovered = await prove(h.port);
      expect(recovered.status, "slot is free after the throw").toBe(200);
      expectHandlesBalanced(h);
    });

    it("client disconnect aborts the run and no further runCompiled call happens", async () => {
      const h = await start();
      h.fake.runDelayMs = 5;
      await proveAndDisconnect(h.port);
      await waitUntil(() => h.fake.live.size === 0 && h.fake.compiles > 0, "handles released after disconnect");
      const callsAfterAbort = h.fake.runCalls;
      await sleep(150);
      expect(h.fake.runCalls, "no runCompiled after the abort settled").toBe(callsAfterAbort);
      expect(callsAfterAbort).toBeLessThan(2000);
      await expectSlotReusable(h);
      expectHandlesBalanced(h);
    });

    it("time budget reached", async () => {
      const h = await start({ timeBudgetMs: 1500 });
      h.fake.runDelayMs = 20;
      const reply = await prove(h.port, { caseCount: 2000 });
      const report = lastEvent(reply.body);
      expect(report["type"]).toBe("report");
      expect(report["complete"]).toBe(false);
      expect(report["budgetReached"]).toBe(true);
      await expectSlotReusable(h);
      expectHandlesBalanced(h);
    });

    it("shutdown ends an in-flight stream with an incomplete report", async () => {
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
      expect(h.fake.shutdowns).toBe(1);
      expectHandlesBalanced(h);
    });

    it("abort that the Engine honours promptly (no watchdog, no reset)", async () => {
      const h = await start();
      h.fake.runDelayMs = 5;
      await proveAndDisconnect(h.port);
      await waitUntil(() => h.fake.live.size === 0 && h.fake.compiles > 0, "handles released");
      expect(h.fake.shutdowns, "watchdog did not reset the backend").toBe(0);
      expect(h.app.probe.state()).toBe("ready");
    });

    it("backstop timeout with millisecond Timings: watchdog marks the Oracle unavailable and resets", async () => {
      let engineStarted = false;
      const hung = ((options: EquivalenceOptions) => {
        engineStarted = true;
        void options;
        return new Promise(() => undefined);
      }) as unknown as typeof runEquivalence;
      const h = await start({
        timeBudgetMs: 30,
        timings: { abortBackstopGraceMs: 30, engineExitGraceMs: 30 },
        engine: hung,
      });
      const started = Date.now();
      const reply = await prove(h.port);
      expect(engineStarted).toBe(true);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(reply.status).toBe(200);
      expect(lastEvent(reply.body)).toMatchObject({ type: "error", code: "timeout" });
      expect(reply.body).not.toContain("matchScore");
      expect(h.fake.shutdowns, "backend reset by the watchdog").toBe(1);
      expect(h.app.probe.state()).toBe("unavailable");
      const health = JSON.parse((await request(h.port, "GET", "/api/health")).body) as Record<string, unknown>;
      expect(health["oracle"]).toBe("unavailable");

      // The slot was released, and the next request re-probes the (fake) Oracle.
      const next = await prove(h.port);
      expect(next.status, "slot free after the watchdog").not.toBe(429);
    });
  });

  // Feature: necromancer-server, Property 12: Every compiled handle is released
  // **Validates: Requirements 9.2, 9.5, 13.3**
  it("releases every handle exactly once for arbitrary runs that end in report, inconclusive or disconnect", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("report", "inconclusive", "disconnect"),
        fc.constantFrom(...SAMPLE_IDS),
        async (path_, sampleId) => {
          const h = await start();
          try {
            h.fake.runDelayMs = path_ === "disconnect" ? 3 : 0;
            h.fake.runStatus = path_ === "inconclusive" ? "timeout" : "ok";
            if (path_ === "disconnect") await proveAndDisconnect(h.port, { sampleId });
            else await prove(h.port, { sampleId });
            await waitUntil(() => h.fake.live.size === 0, "handles released");
            expect(h.fake.releases).toBe(h.fake.compiles);
            for (const [, count] of h.fake.releaseCounts) expect(count).toBe(1);
          } finally {
            const current = harness;
            harness = null;
            if (current !== null) {
              await current.app.shutdown();
              await rm(current.dir, { recursive: true, force: true });
            }
          }
        },
      ),
      { numRuns: 6 },
    );
  }, 60_000);

  // Feature: necromancer-server, Property 11: Run_Slot is taken and released exactly once on every exit path
  // **Validates: Requirements 9.6**
  it("answers 503 shutting_down once shutdown has begun and never takes the slot", async () => {
    const h = await start();
    h.app.state.shuttingDown = true;
    const reply = await prove(h.port);
    expect(reply.status).toBe(503);
    expect(JSON.parse(reply.body)).toMatchObject({ type: "error", code: "shutting_down" });
    expect(h.fake.compiles).toBe(0);
    h.app.state.shuttingDown = false;
    await expectSlotReusable(h);
  });
});



