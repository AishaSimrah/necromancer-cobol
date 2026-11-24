import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEquivalence } from "../../src/equivalence/index.js";
import * as oracle from "../../src/oracle/index.js";
import { createApp, type App } from "../../src/server/app.js";
import { parseCobcVersion } from "../../src/server/cobc-version.js";
import type { AppDeps, OracleBackend } from "../../src/server/types.js";
import { getSample, getTranslation } from "../../src/translator/index.js";

/**
 * Real-Oracle integration tests: real catalog, real Engine, real GnuCOBOL.
 * Docker mode by default; In_Image_Mode when NECROMANCER_IN_ORACLE_IMAGE=1.
 * A missing prerequisite fails the run with a message naming it. Nothing is skipped.
 */

const IN_IMAGE = process.env["NECROMANCER_IN_ORACLE_IMAGE"] === "1";
const ORACLE_IMAGE = "necromancer-oracle";
const WORKER_BUNDLE = "/opt/oracle/worker.js";
const SEED = 1;
const CASE_COUNT = 1000;
const TEST_TIMEOUT = 120_000;
const HOOK_TIMEOUT = 180_000;

function succeeds(command: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: 30_000, windowsHide: true }, (error) => {
      resolve(error === null);
    });
  });
}

async function preflight(): Promise<void> {
  if (IN_IMAGE) {
    if (!(await succeeds("cobc", ["--version"]))) throw new Error("cobc not found");
    if (!existsSync(WORKER_BUNDLE)) throw new Error(`worker bundle ${WORKER_BUNDLE} missing`);
    return;
  }
  if (!(await succeeds("docker", ["version"]))) {
    throw new Error("Docker daemon is not running or not reachable");
  }
  if (!(await succeeds("docker", ["image", "inspect", ORACLE_IMAGE]))) {
    throw new Error(`Oracle_Image '${ORACLE_IMAGE}' is missing: run docker build -t ${ORACLE_IMAGE} .`);
  }
}

/** In Docker mode cobc lives in the Oracle_Image, not on the host, so ask the image. */
function cobcVersionFromOracle(): Promise<string | null> {
  const [file, args] = IN_IMAGE
    ? (["cobc", ["--version"]] as const)
    : (["docker", ["run", "--rm", ORACLE_IMAGE, "cobc", "--version"]] as const);
  return new Promise((resolve) => {
    execFile(file, [...args], { timeout: 30_000, windowsHide: true }, (error, stdout) => {
      resolve(error === null ? parseCobcVersion(stdout) : null);
    });
  });
}

interface Reply {
  readonly status: number;
  readonly body: string;
}

function request(port: number, method: string, requestPath: string, body?: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Connection: "close" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const req = http.request({ host: "127.0.0.1", port, method, path: requestPath, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
  return value as Record<string, unknown>;
}

/** Runs a proof over HTTP and returns the last NDJSON line, which must be a report. */
async function proveReport(port: number, variant: string): Promise<Record<string, unknown>> {
  const reply = await request(
    port,
    "POST",
    "/api/prove",
    JSON.stringify({ sampleId: "interest", variant, caseCount: CASE_COUNT, seed: SEED }),
  );
  expect(reply.status).toBe(200);
  const lines = reply.body.trimEnd().split("\n");
  const last = asRecord(JSON.parse(lines[lines.length - 1] as string) as unknown);
  expect(last["type"], reply.body.slice(-300)).toBe("report");
  return last;
}

describe("real Oracle integration", () => {
  let dir: string;
  let app: App;
  let port: number;
  const scores = new Map<string, number>();

  beforeAll(async () => {
    await preflight();
    dir = await mkdtemp(path.join(os.tmpdir(), "necro-integration-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    const backend: OracleBackend = oracle;
    const deps: AppDeps = {
      config: {
        port: 0,
        defaultCaseCount: CASE_COUNT,
        maxCaseCount: 2000,
        timeBudgetMs: 100_000,
        workRoot: IN_IMAGE ? path.join(dir, "work") : "/work",
      },
      timings: {
        abortBackstopGraceMs: 5000,
        engineExitGraceMs: 5000,
        probeTimeoutMs: 60_000,
        probeMinIntervalMs: 0,
        shutdownDeadlineMs: 5000,
      },
      backend,
      engine: runEquivalence,
      catalog: { getSample, getTranslation },
      staticRoot: dir,
      cobcVersion: cobcVersionFromOracle,
      logger: { line: () => undefined },
      now: () => Date.now(),
    };
    app = createApp(deps);
    port = await new Promise<number>((resolve, reject) => {
      app.server.once("error", reject);
      app.server.listen(0, "127.0.0.1", () => {
        resolve((app.server.address() as AddressInfo).port);
      });
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (app !== undefined) await app.shutdown();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }, HOOK_TIMEOUT);

  it("GET /api/health?probe=1 reports a ready Oracle and GnuCOBOL 3.1.2", { timeout: TEST_TIMEOUT }, async () => {
    const reply = await request(port, "GET", "/api/health?probe=1");
    expect(reply.status).toBe(200);
    const body = asRecord(JSON.parse(reply.body) as unknown);
    expect(body["oracle"]).toBe("ready");
    expect(String(body["cobcVersion"]).startsWith("3.1.2")).toBe(true);
  });

  it("interest/correct scores 1 and is complete", { timeout: TEST_TIMEOUT }, async () => {
    const report = await proveReport(port, "correct");
    expect(report["matchScore"]).toBe(1);
    expect(report["complete"]).toBe(true);
    scores.set("correct", 1);
  });

  it("interest/naive scores below 1 with well-formed mismatches", { timeout: TEST_TIMEOUT }, async () => {
    const report = await proveReport(port, "naive");
    const score = report["matchScore"] as number;
    expect(score).toBeLessThan(1);
    const mismatches = report["mismatches"] as unknown[];
    expect(mismatches.length).toBeGreaterThan(0);
    for (const m of mismatches) {
      const item = asRecord(m);
      for (const key of ["input", "oracleOutput", "candidateOutput", "group"]) {
        expect(Object.hasOwn(item, key), `mismatch has ${key}`).toBe(true);
      }
    }
    scores.set("naive", score);
  });

  it("interest/subtle scores between naive and 1 for the same seed", { timeout: TEST_TIMEOUT }, async () => {
    const report = await proveReport(port, "subtle");
    const score = report["matchScore"] as number;
    expect(score).toBeLessThan(1);
    const naive = scores.get("naive");
    if (naive === undefined) throw new Error("naive score not recorded: the naive test must pass first");
    expect(score).toBeGreaterThan(naive);
  });
});
