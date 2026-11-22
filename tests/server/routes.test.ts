import fc from "fast-check";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { runEquivalence } from "../../src/equivalence/index.js";
import type { CompiledHandle, RunResult } from "../../src/oracle/index.js";
import { createApp, type App } from "../../src/server/app.js";
import type { AppDeps, OracleBackend } from "../../src/server/types.js";
import { getSample, getTranslation, SAMPLE_IDS } from "../../src/translator/index.js";

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const INDEX_HTML = "<!doctype html><title>index-marker</title>";
const IDS: readonly string[] = ["interest", "payroll", "tax"];
const VARIANT_ORDER: readonly string[] = ["correct", "subtle", "naive"];
const SUMMARY_KEYS: readonly string[] = ["defaultInput", "id", "name", "trapLabel"];

const interestSample = getSample("interest");
const firstExample = interestSample.examples[0];
if (firstExample === undefined) throw new Error("interest sample has no example");
const PROBE_OUTPUT: string = firstExample.output;

const HANDLE = { id: "fake" } as unknown as CompiledHandle;

function okResult(stdout: string): RunResult {
  return { status: "ok", stdout, stderr: "", exitCode: 0, truncated: false, durationMs: 1 };
}

const BAD_RESULT: RunResult = {
  status: "environment_error",
  stdout: "",
  stderr: "",
  exitCode: null,
  truncated: false,
  durationMs: 0,
  message: "fake backend",
};

/** Backend whose probe succeeds only while `control.ready` is true. */
function makeBackend(control: { ready: boolean }): OracleBackend {
  return {
    compileCobol: () => Promise.resolve(control.ready ? HANDLE : BAD_RESULT),
    runCompiled: () => Promise.resolve(control.ready ? okResult(PROBE_OUTPUT) : BAD_RESULT),
    releaseHandle: () => Promise.resolve(),
    isCompiledHandle: (value: unknown): value is CompiledHandle => value === HANDLE,
    shutdown: () => Promise.resolve(),
  };
}

const throwingEngine = ((): Promise<never> => Promise.reject(new Error("engine must not run"))) as unknown as typeof runEquivalence;

type Catalog = AppDeps["catalog"];

const plainCatalog: Catalog = { getSample, getTranslation };

/** A catalog whose objects carry extra enumerable properties (functions, `candidate`, unknown keys). */
const pollutedCatalog: Catalog = {
  getSample: ((id) => ({
    ...getSample(id),
    candidate: () => 1, // Not on Sample; proves unknown keys are dropped.
    extraFn: () => 2,
    extraKey: "leak",
  })) as Catalog["getSample"],
  getTranslation: ((id, variant) => ({
    ...getTranslation(id, variant),
    extraFn: () => 4,
    module: { run: () => 5 },
  })) as Catalog["getTranslation"],
};

const brokenCatalog: Catalog = {
  getSample: (() => {
    throw new Error("catalog broke at C:\\secret\\path\n    at stack frame");
  }) as Catalog["getSample"],
  getTranslation,
};

function makeDeps(staticRoot: string, catalog: Catalog, backend: OracleBackend, logs: string[]): AppDeps {
  return {
    config: {
      port: 0,
      defaultCaseCount: 1000,
      maxCaseCount: 2000,
      timeBudgetMs: 60_000,
      workRoot: path.join(os.tmpdir(), "necro-routes-work"),
    },
    timings: {
      abortBackstopGraceMs: 50,
      engineExitGraceMs: 50,
      probeTimeoutMs: 500,
      probeMinIntervalMs: 0,
      shutdownDeadlineMs: 500,
    },
    backend,
    engine: throwingEngine,
    catalog,
    staticRoot,
    cobcVersion: () => Promise.resolve("3.1.2.0"),
    logger: {
      line: (text: string) => {
        logs.push(text);
      },
    },
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

function send(port: number, method: string, requestPath: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers: { Connection: "close" }, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parse(reply: Reply): JsonValue {
  return JSON.parse(reply.body) as JsonValue;
}

function asObject(value: JsonValue): { [key: string]: JsonValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object");
  return value;
}

function asArray(value: JsonValue): JsonValue[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value;
}

function sortedKeys(value: JsonValue): string[] {
  return Object.keys(asObject(value)).sort();
}

function expectNotFoundJson(reply: Reply, label: string): void {
  expect(reply.status, label).toBe(404);
  expect(reply.headers["content-type"], label).toContain("application/json");
  expect(reply.body, label).not.toContain("index-marker");
  const body = asObject(parse(reply));
  expect(Object.keys(body).sort(), label).toEqual(["code", "message", "type"]);
  expect(body["type"], label).toBe("error");
  expect(body["code"], label).toBe("not_found");
}

/** Walks a parsed JSON value and reports any key named `candidate` or non-JSON value. */
function collectKeys(value: JsonValue, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
}

const SAFE_PATH_CHARS: readonly string[] = [..."abcxyzABC019-_.~!$&'()*+,;=:@".split(""), "%2e", "%2f", "%00", "%zz", "%E0%A4%A", "%"];

const arbSuffix: fc.Arbitrary<string> = fc.array(fc.constantFrom(...SAFE_PATH_CHARS), { maxLength: 10 }).map((p) => p.join(""));

describe("routes", () => {
  let dir: string;
  let app: App;
  let port: number;
  let polluted: App;
  let pollutedPort: number;
  let broken: App;
  let brokenPort: number;
  const control = { ready: false };
  const logs: string[] = [];
  const brokenLogs: string[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "necro-routes-"));
    await writeFile(path.join(dir, "index.html"), INDEX_HTML);
    app = createApp(makeDeps(dir, plainCatalog, makeBackend(control), logs));
    polluted = createApp(makeDeps(dir, pollutedCatalog, makeBackend({ ready: true }), []));
    broken = createApp(makeDeps(dir, brokenCatalog, makeBackend({ ready: true }), brokenLogs));
    port = await listen(app);
    pollutedPort = await listen(polluted);
    brokenPort = await listen(broken);
  });

  afterAll(async () => {
    await app.shutdown();
    await polluted.shutdown();
    await broken.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  // Feature: necromancer-server, Property 5: Unknown API paths and unknown sample ids are 404 JSON
  // **Validates: Requirements 2.8, 6.4**
  it("answers 404 JSON for any unknown sample id", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string({ maxLength: 12 }).map((s) => encodeURIComponent(s)), arbSuffix), async (segment) => {
        let decoded: string | null;
        try {
          decoded = decodeURIComponent(segment);
        } catch {
          decoded = null;
        }
        fc.pre(decoded === null || !IDS.includes(decoded));
        const reply = await send(port, "GET", `/api/samples/${segment}`);
        expectNotFoundJson(reply, segment);
      }),
      { numRuns: 60 },
    );
  });

  it("answers 404 JSON for named hostile and malformed sample ids", async () => {
    const segments = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
      "%5F%5Fproto%5F%5F",
      "%zz",
      "%E0%A4%A",
      "%",
      "interest%2F",
      "%2569nterest",
      "interest%00",
      "Interest",
      "interest.",
      "",
      "interest/extra",
    ];
    for (const s of segments) {
      expectNotFoundJson(await send(port, "GET", `/api/samples/${s}`), s);
    }
  });

  // Feature: necromancer-server, Property 5: Unknown API paths and unknown sample ids are 404 JSON
  // **Validates: Requirements 2.8, 6.4**
  it("answers 404 JSON, never index.html, for any undefined path under /api/", async () => {
    await fc.assert(
      fc.asyncProperty(arbSuffix, async (suffix) => {
        const requestPath = `/api/${suffix}`;
        fc.pre(!["/api/health", "/api/samples", "/api/prove"].includes(requestPath));
        fc.pre(!requestPath.startsWith("/api/samples/"));
        expectNotFoundJson(await send(port, "GET", requestPath), requestPath);
      }),
      { numRuns: 60 },
    );
    expectNotFoundJson(await send(port, "GET", "/api"), "/api");
    expectNotFoundJson(await send(port, "GET", "/api/"), "/api/");
    expectNotFoundJson(await send(port, "GET", "/api/index.html"), "/api/index.html");
  });

  it("still serves index.html for the root", async () => {
    const reply = await send(port, "GET", "/");
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(INDEX_HTML);
  });

  describe("sample list and detail", () => {
    // Feature: necromancer-server, Property 6: Sample responses are allowlisted data
    // **Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3**
    it("lists three samples in order with exactly four keys", async () => {
      for (const p of [port, pollutedPort]) {
        const reply = await send(p, "GET", "/api/samples");
        expect(reply.status).toBe(200);
        expect(reply.headers["content-type"]).toContain("application/json");
        const list = asArray(parse(reply));
        expect(list).toHaveLength(3);
        expect(list.map((item) => asObject(item)["id"])).toEqual([...SAMPLE_IDS]);
        for (const item of list) expect(sortedKeys(item)).toEqual(SUMMARY_KEYS);
        const keys: string[] = [];
        collectKeys(parse(reply), keys);
        expect(keys).not.toContain("candidate");
      }
    });

    // Feature: necromancer-server, Property 6: Sample responses are allowlisted data
    // **Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3**
    it("returns allowlisted detail with ordered translations whose source equals the file on disk", async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...SAMPLE_IDS), fc.constantFrom(port, pollutedPort), async (id, p) => {
          const reply = await send(p, "GET", `/api/samples/${id}`);
          expect(reply.status).toBe(200);
          const detail = asObject(parse(reply));
          expect(Object.keys(detail).sort()).toEqual(
            [
              "cobolSource",
              "curses",
              "defaultInput",
              "examples",
              "fidelityPact",
              "fields",
              "id",
              "name",
              "trapLabel",
              "translations",
            ].sort(),
          );
          expect(reply.body).not.toContain("extraKey");
          expect(reply.body).not.toContain("extraFn");
          const keys: string[] = [];
          collectKeys(detail, keys);
          expect(keys).not.toContain("candidate");
          expect(keys).not.toContain("module");
          const translations = asArray(detail["translations"] ?? null);
          expect(translations.map((t) => asObject(t)["variant"])).toEqual(VARIANT_ORDER);
          for (const t of translations) {
            const obj = asObject(t);
            expect(Object.keys(obj).sort()).toEqual(["markers", "provenance", "source", "variant"]);
            const file = path.resolve("src", "translator", "translations", `${id}.${String(obj["variant"])}.ts`);
            expect(obj["source"]).toBe(await readFile(file, "utf8"));
          }
          const cobolFile = path.resolve("cobol-samples", `${id}.cbl`);
          expect(detail["cobolSource"]).toBe(await readFile(cobolFile, "utf8"));
        }),
        { numRuns: 12 },
      );
    });
  });

  describe("catalog failure", () => {
    it("answers a generic 500 and logs the cause", async () => {
      for (const p of ["/api/samples", "/api/samples/interest"]) {
        const before = brokenLogs.length;
        const reply = await send(brokenPort, "GET", p);
        expect(reply.status).toBe(500);
        expect(reply.headers["content-type"]).toContain("application/json");
        const body = asObject(parse(reply));
        expect(body["type"]).toBe("error");
        expect(body["code"]).toBe("internal_error");
        expect(reply.body).not.toContain("secret");
        expect(reply.body).not.toContain("catalog broke");
        expect(reply.body).not.toContain("stack");
        expect(reply.body).not.toContain("\\\\");
        expect(brokenLogs.slice(before).some((l) => l.includes("catalog broke"))).toBe(true);
      }
    });
  });

  describe("method handling", () => {
    it("answers 405 with Allow: GET on both sample routes", async () => {
      for (const p of ["/api/samples", "/api/samples/interest"]) {
        for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
          const reply = await send(port, method, p);
          expect(reply.status, `${method} ${p}`).toBe(405);
          expect(reply.headers["allow"], `${method} ${p}`).toBe("GET");
          const body = asObject(parse(reply));
          expect(body["code"]).toBe("method_not_allowed");
        }
      }
    });

    it("answers 405 with Allow: GET on /api/health", async () => {
      const reply = await send(port, "POST", "/api/health");
      expect(reply.status).toBe(405);
      expect(reply.headers["allow"]).toBe("GET");
    });
  });

  describe("health", () => {
    it("reports degraded with 200, then ok after a forced probe, then degraded again", async () => {
      control.ready = false;
      const first = await send(port, "GET", "/api/health");
      expect(first.status).toBe(200);
      const degraded = asObject(parse(first));
      expect(Object.keys(degraded).sort()).toEqual(["cobcVersion", "oracle", "status", "uptimeMs"]);
      expect(degraded["status"]).toBe("degraded");
      expect(degraded["oracle"]).toBe("unavailable");
      expect(degraded["cobcVersion"]).toBe("3.1.2.0");
      expect(typeof degraded["uptimeMs"]).toBe("number");

      control.ready = true;
      const withoutProbe = asObject(parse(await send(port, "GET", "/api/health")));
      expect(withoutProbe["oracle"]).toBe("unavailable");

      const probed = await send(port, "GET", "/api/health?probe=1");
      expect(probed.status).toBe(200);
      const ready = asObject(parse(probed));
      expect(ready["status"]).toBe("ok");
      expect(ready["oracle"]).toBe("ready");

      control.ready = false;
      const stillReady = asObject(parse(await send(port, "GET", "/api/health")));
      expect(stillReady["oracle"]).toBe("ready");

      const reprobed = await send(port, "GET", "/api/health?probe=1");
      expect(reprobed.status).toBe(200);
      const down = asObject(parse(reprobed));
      expect(down["status"]).toBe("degraded");
      expect(down["oracle"]).toBe("unavailable");
    });
  });
});
