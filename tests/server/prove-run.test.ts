import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runEquivalence } from "../../src/equivalence/index.js";
import type { EquivalenceOptions } from "../../src/equivalence/index.js";
import type { CompiledHandle, RunResult } from "../../src/oracle/index.js";
import type { PartialOracleConfig } from "../../src/oracle/config.js";
import { createApp, type App } from "../../src/server/app.js";
import type { AppDeps, OracleBackend } from "../../src/server/types.js";
import { getSample, getTranslation } from "../../src/translator/index.js";
import { SAMPLE_IDS, VARIANTS } from "../../src/translator/types.js";
import type { SampleId, Variant } from "../../src/translator/types.js";

type Mode = "ok" | "compile_fail" | "run_timeout";

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

interface CompileCall {
  readonly source: string;
  readonly config: PartialOracleConfig | undefined;
}

interface FakeState {
  mode: Mode;
  compileCalls: CompileCall[];
  runCalls: number;
  releases: number;
  shutdowns: number;
  engineCalls: EquivalenceOptions[];
  engineThrows: boolean;
}

const MAX_CASES = 100_000;

const state: FakeState = {
  mode: "ok",
  compileCalls: [],
  runCalls: 0,
  releases: 0,
  shutdowns: 0,
  engineCalls: [],
  engineThrows: false,
};

/** Fake handles remember which catalog sample they were compiled from. */
const handles = new Map<CompiledHandle, SampleId>();

function sampleIdOfSource(source: string): SampleId | undefined {
  return SAMPLE_IDS.find((id) => getSample(id).cobolSource === source);
}

function failure(status: RunResult["status"]): RunResult {
  return { status, stdout: "", stderr: "", exitCode: null, truncated: false, durationMs: 0, message: "fake failure" };
}

/**
 * Fake Oracle backend. It plays the part of GnuCOBOL by running the catalog's `correct` translation,
 * so the `correct` variant scores 1 and the others can diverge. No Docker, no cobc.
 */
const fakeBackend: OracleBackend = {
  compileCobol: (source, config) => {
    state.compileCalls.push({ source, config });
    if (state.mode === "compile_fail") return Promise.resolve(failure("environment_error"));
    const id = sampleIdOfSource(source);
    if (id === undefined) return Promise.resolve(failure("compile_error"));
    const handle = { id: `fake-${String(handles.size)}` } as unknown as CompiledHandle;
    handles.set(handle, id);
    return Promise.resolve(handle);
  },
  runCompiled: async (handle, inputLines) => {
    state.runCalls += 1;
    const id = handles.get(handle);
    if (id === undefined || state.mode === "run_timeout") return failure("timeout");
    const stdout = await getTranslation(id, "correct").candidate([...inputLines]);
    return { status: "ok", stdout, stderr: "", exitCode: 0, truncated: false, durationMs: 0 };
  },
  releaseHandle: (handle) => {
    state.releases += 1;
    handles.delete(handle);
    return Promise.resolve();
  },
  isCompiledHandle: (value: unknown): value is CompiledHandle => handles.has(value as CompiledHandle),
  shutdown: () => {
    state.shutdowns += 1;
    return Promise.resolve();
  },
};

/** The real Engine, wrapped only to record the options the server passes and to inject a throw. */
const recordingEngine = ((options: EquivalenceOptions) => {
  state.engineCalls.push(options);
  if (state.engineThrows) return Promise.reject(new Error("engine blew up at /secret/path"));
  return runEquivalence(options);
}) as unknown as typeof runEquivalence;

function makeDeps(staticRoot: string): AppDeps {
  return {
    config: {
      port: 0,
      defaultCaseCount: 1000,
      maxCaseCount: MAX_CASES,
      timeBudgetMs: 60_000,
      workRoot: path.join(os.tmpdir(), "necro-prove-run-work"),
    },
    timings: {
      abortBackstopGraceMs: 50,
      engineExitGraceMs: 50,
      probeTimeoutMs: 2000,
      probeMinIntervalMs: 0,
      shutdownDeadlineMs: 500,
    },
    backend: fakeBackend,
    engine: recordingEngine,
    catalog: { getSample, getTranslation },
    staticRoot,
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

function prove(port: number, body: Record<string, unknown>): Promise<Reply> {
  return request(port, "POST", "/api/prove", JSON.stringify(body));
}

/** Warms the probe so later requests do not include the probe's own compile call. */
async function warmProbe(port: number): Promise<void> {
  state.mode = "ok";
  const reply = await request(port, "GET", "/api/health?probe=1");
  expect(JSON.parse(reply.body)).toMatchObject({ oracle: "ready" });
}

function resetCounters(): void {
  state.compileCalls = [];
  state.runCalls = 0;
  state.releases = 0;
  state.engineCalls = [];
  state.engineThrows = false;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
  return value as Record<string, unknown>;
}

/** Splits an NDJSON body: every line must be non-empty valid JSON and the body must end with "\n". */
function parseNdjson(body: string): Record<string, unknown>[] {
  expect(body.endsWith("\n"), "body ends with a newline").toBe(true);
  const lines = body.slice(0, -1).split("\n");
  return lines.map((line) => {
    expect(line.length, "no empty line").toBeGreaterThan(0);
    return asRecord(JSON.parse(line) as unknown);
  });
}

function hasScoreKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasScoreKey);
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([k, v]) => k.toLowerCase().includes("score") || hasScoreKey(v));
}

const PROGRESS_KEYS: readonly string[] = ["completed", "group", "inconclusive", "matched", "mismatches", "target", "type"];
const REPORT_KEYS: readonly string[] = [
  "aborted",
  "budgetReached",
  "caseCount",
  "casesRun",
  "complete",
  "conclusiveCount",
  "elapsedMs",
  "groups",
  "inconclusiveByStatus",
  "inconclusiveCount",
  "matchScore",
  "matchedCount",
  "mismatchCount",
  "mismatchListTruncated",
  "mismatches",
  "sampleId",
  "seed",
  "shrunkExamples",
  "type",
  "variant",
];

/** Structural checks shared by every streamed run that ends in a report. */
function expectProgressThenReport(events: readonly Record<string, unknown>[]): Record<string, unknown> {
  expect(events.length).toBeGreaterThanOrEqual(1);
  const finals = events.filter((e) => e["type"] !== "progress");
  expect(finals.length, "exactly one final line").toBe(1);
  const last = events[events.length - 1] as Record<string, unknown>;
  expect(last, "the final line is last, nothing after it").toBe(finals[0]);
  let previous = 0;
  for (const e of events.slice(0, -1)) {
    expect(e["type"]).toBe("progress");
    expect(Object.keys(e).sort()).toEqual(PROGRESS_KEYS);
    expect(Object.keys(e).some((k) => k.toLowerCase().includes("score"))).toBe(false);
    const completed = e["completed"] as number;
    expect(completed).toBeGreaterThanOrEqual(previous);
    previous = completed;
  }
  return last;
}

function expectErrorEvent(event: Record<string, unknown>, code: string): void {
  expect(Object.keys(event).sort()).toEqual(["code", "message", "type"]);
  expect(event["type"]).toBe("error");
  expect(event["code"]).toBe(code);
  expect(typeof event["message"]).toBe("string");
  expect(hasScoreKey(event)).toBe(false);
}

const arbSampleId: fc.Arbitrary<SampleId> = fc.constantFrom(...SAMPLE_IDS);
const arbVariant: fc.Arbitrary<Variant> = fc.constantFrom(...VARIANTS);

describe("POST /api/prove streaming with the fake Oracle", { timeout: 60_000 }, () => {
  let dir: string;
  let app: App;
  let port: number;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "necro-prove-run-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    app = createApp(makeDeps(dir));
    port = await listen(app);
  });

  afterAll(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    state.mode = "ok";
    state.engineThrows = false;
    await warmProbe(port);
    resetCounters();
  });

  // Feature: necromancer-server, Property 10: NDJSON framing
  // Feature: necromancer-server, Property 9: Only a completed Engine outcome can produce a score, and error events never contain one
  // Feature: necromancer-server, Property 13: Only catalog COBOL and the catalog Candidate reach the Oracle
  // **Validates: Requirements 8.1, 8.2, 8.4, 8.7, 8.8, 8.9, 8.10, 4.7, 7.10**
  it("streams valid NDJSON that ends in one complete report and feeds the Oracle only catalog data", { timeout: 60_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSampleId,
        arbVariant,
        fc.integer({ min: 100, max: 250 }),
        fc.option(fc.integer({ min: -2147483648, max: 2147483647 }), { nil: undefined }),
        async (sampleId, variant, caseCount, seed) => {
          resetCounters();
          const body: Record<string, unknown> = { sampleId, variant, caseCount };
          if (seed !== undefined) body["seed"] = seed;
          const reply = await prove(port, body);

          expect(reply.status, reply.body.slice(0, 200)).toBe(200);
          expect(reply.headers["content-type"]).toBe("application/x-ndjson; charset=utf-8");
          expect(reply.headers["cache-control"]).toBe("no-store");
          const events = parseNdjson(reply.body);
          const report = expectProgressThenReport(events);

          expect(report["type"]).toBe("report");
          expect(Object.keys(report).sort()).toEqual(REPORT_KEYS);
          expect(report["sampleId"]).toBe(sampleId);
          expect(report["variant"]).toBe(variant);
          expect(report["caseCount"]).toBe(caseCount);
          if (seed !== undefined) expect(report["seed"]).toBe(seed);
          const matched = report["matchedCount"] as number;
          const conclusive = report["conclusiveCount"] as number;
          expect(conclusive).toBeGreaterThan(0);
          expect(report["matchScore"]).toBe(matched / conclusive);
          expect(report["complete"]).toBe(true);
          if (variant === "correct") {
            expect(report["matchScore"]).toBe(1);
            expect(report["mismatchCount"]).toBe(0);
          }
          const progress = events.slice(0, -1);
          expect(progress.length).toBe(report["casesRun"]);

          // Property 13: only catalog COBOL and the catalog Candidate were used.
          const sample = getSample(sampleId);
          expect(state.compileCalls.length).toBeGreaterThan(0);
          for (const call of state.compileCalls) expect(call.source).toBe(sample.cobolSource);
          expect(state.engineCalls.length).toBe(1);
          const options = state.engineCalls[0] as EquivalenceOptions;
          expect(options.source).toBe(sample.cobolSource);
          expect(options.candidate).toBe(getTranslation(sampleId, variant).candidate);
          expect(options.caseCount).toBe(caseCount);
          expect(state.releases).toBe(state.compileCalls.length);
        },
      ),
      { numRuns: 12 },
    );
  });

  // Feature: necromancer-server, Property 9: Only a completed Engine outcome can produce a score, and error events never contain one
  // **Validates: Requirements 8.7, 8.8, 8.9, 8.10**
  describe("error outcomes carry no score", () => {
    it("answers 503 with a single error line when the Oracle is unavailable at the start", async () => {
      state.mode = "compile_fail";
      // Force the probe to see the failure, so the state is "unavailable".
      const health = await request(port, "GET", "/api/health?probe=1");
      expect(JSON.parse(health.body)).toMatchObject({ oracle: "unavailable" });
      resetCounters();

      const reply = await prove(port, { sampleId: "interest", variant: "correct", caseCount: 100 });
      expect(reply.status).toBe(503);
      expect(reply.headers["content-type"]).toContain("application/x-ndjson");
      expect(reply.body).not.toContain("matchScore");
      const events = parseNdjson(reply.body);
      expect(events.length).toBe(1);
      expectErrorEvent(events[0] as Record<string, unknown>, "oracle_unavailable");
      expect(state.engineCalls.length).toBe(0);

      // Recovery: the slot was never taken, and a working Oracle is probed again.
      state.mode = "ok";
      const again = await prove(port, { sampleId: "interest", variant: "correct", caseCount: 100 });
      expect(again.status).toBe(200);
      expect(expectProgressThenReport(parseNdjson(again.body))["type"]).toBe("report");
    });

    it("turns an Engine oracle_unavailable outcome into an error event and re-probes next time", async () => {
      state.mode = "compile_fail"; // the state is still "ready", so the Engine runs and fails at compile
      const reply = await prove(port, { sampleId: "tax", variant: "naive", caseCount: 100 });
      expect(reply.status).toBe(200);
      expect(reply.body).not.toContain("matchScore");
      const events = parseNdjson(reply.body);
      expect(events.length).toBe(1);
      expectErrorEvent(events[0] as Record<string, unknown>, "oracle_unavailable");
      expect(state.engineCalls.length).toBe(1);

      const next = await prove(port, { sampleId: "tax", variant: "naive", caseCount: 100 });
      expect(next.status).toBe(503);
      expectErrorEvent(parseNdjson(next.body)[0] as Record<string, unknown>, "oracle_unavailable");
      expect(next.body).not.toContain("matchScore");
    });

    it("turns an inconclusive Engine outcome into an error event after valid progress lines", async () => {
      state.mode = "run_timeout";
      const reply = await prove(port, { sampleId: "payroll", variant: "correct", caseCount: 100 });
      expect(reply.status).toBe(200);
      expect(reply.body).not.toContain("matchScore");
      const events = parseNdjson(reply.body);
      const last = expectProgressThenReport(events);
      expectErrorEvent(last, "inconclusive");
      expect(events.length).toBeGreaterThan(1);
      expect(state.releases).toBe(state.compileCalls.length);
    });

    it("turns an Engine throw into an error event, hides the cause and frees the slot", async () => {
      state.engineThrows = true;
      const reply = await prove(port, { sampleId: "interest", variant: "subtle", caseCount: 100 });
      expect(reply.status).toBe(200);
      expect(reply.body).not.toContain("matchScore");
      expect(reply.body).not.toContain("/secret/path");
      expect(reply.body).not.toContain("blew up");
      const events = parseNdjson(reply.body);
      expect(events.length).toBe(1);
      expectErrorEvent(events[0] as Record<string, unknown>, "internal_error");

      state.engineThrows = false;
      const after = await prove(port, { sampleId: "interest", variant: "subtle", caseCount: 100 });
      expect(after.status, "slot is free (not 429)").toBe(200);
      expect(expectProgressThenReport(parseNdjson(after.body))["type"]).toBe("report");
    });
  });

  // Feature: necromancer-server, Property 10: NDJSON framing
  // **Validates: Requirements 8.2, 8.4**
  it("applies backpressure to a slow reader and still delivers every line in order", { timeout: 60_000 }, async () => {
    const caseCount = 20_000;
    const payload = JSON.stringify({ sampleId: "interest", variant: "correct", caseCount, seed: 7 });
    const received: Buffer[] = [];
    const sample = (): number => state.runCalls;

    const finished = new Promise<void>((resolve, reject) => {
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
          expect(res.statusCode).toBe(200);
          res.pause(); // slow reader: read nothing for a while
          res.on("data", (c: Buffer) => received.push(c));
          res.on("end", resolve);
          res.on("error", reject);
          void (async () => {
            // Socket buffers fill at a machine-dependent rate. Wait until the counter stops moving
            // for 600 ms (the Engine waits in onProgress for `drain`), within a 20 s deadline.
            const deadline = Date.now() + 20_000;
            let last = -1;
            let stable = false;
            while (!stable && Date.now() < deadline) {
              last = sample();
              await new Promise((r) => setTimeout(r, 600));
              stable = sample() === last;
            }
            expect(stable, "run stalls while the reader is paused").toBe(true);
            expect(last, "run did not finish").toBeLessThan(caseCount);
            res.resume();
          })().catch(reject);
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
    await finished;

    const events = parseNdjson(Buffer.concat(received).toString("utf8"));
    const report = expectProgressThenReport(events);
    expect(report["type"]).toBe("report");
    expect(report["matchScore"]).toBe(1);
    expect(events.length - 1).toBe(report["casesRun"]);
    expect(report["casesRun"]).toBe(state.runCalls);
  });
});
