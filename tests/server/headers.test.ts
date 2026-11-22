import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { runEquivalence } from "../../src/equivalence/index.js";
import type { CompiledHandle, RunResult } from "../../src/oracle/index.js";
import { createApp, type App } from "../../src/server/app.js";
import type { AppDeps, OracleBackend } from "../../src/server/types.js";
import { getSample, getTranslation } from "../../src/translator/index.js";

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
}

const NO_RESULT: RunResult = {
  status: "environment_error",
  stdout: "",
  stderr: "",
  exitCode: null,
  truncated: false,
  durationMs: 0,
  message: "fake backend",
};

const fakeBackend: OracleBackend = {
  compileCobol: () => Promise.resolve(NO_RESULT),
  runCompiled: () => Promise.resolve(NO_RESULT),
  releaseHandle: () => Promise.resolve(),
  isCompiledHandle: (value: unknown): value is CompiledHandle => {
    void value;
    return false;
  },
  shutdown: () => Promise.resolve(),
};

const throwingEngine = ((): Promise<never> => Promise.reject(new Error("engine must not run"))) as unknown as typeof runEquivalence;

function throwingGetSample(): never {
  throw new Error("catalog broke at C:\\secret\\path");
}

function makeDeps(staticRoot: string, throwingCatalog: boolean): AppDeps {
  return {
    config: {
      port: 0,
      defaultCaseCount: 1000,
      maxCaseCount: 2000,
      timeBudgetMs: 60_000,
      workRoot: path.join(os.tmpdir(), "necro-headers-work"),
    },
    timings: {
      abortBackstopGraceMs: 50,
      engineExitGraceMs: 50,
      probeTimeoutMs: 500,
      probeMinIntervalMs: 0,
      shutdownDeadlineMs: 500,
    },
    backend: fakeBackend,
    engine: throwingEngine,
    catalog: throwingCatalog
      ? { getSample: throwingGetSample as unknown as typeof getSample, getTranslation }
      : { getSample, getTranslation },
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

function send(
  port: number,
  method: string,
  requestPath: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers: { ...headers, Connection: "close" }, agent: false },
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

function pathOf(requestPath: string): string {
  const q = requestPath.indexOf("?");
  return q === -1 ? requestPath : requestPath.slice(0, q);
}

function expectSecurityHeaders(reply: Reply, requestPath: string): void {
  const h = reply.headers;
  expect(h["content-security-policy"]).toBe("default-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["server"]).toBeUndefined();
  expect(Object.keys(h).filter((k) => k.startsWith("access-control-"))).toEqual([]);
  const p = pathOf(requestPath);
  if (p === "/api" || p.startsWith("/api/")) expect(h["cache-control"]).toBe("no-store");
}

const PATH_CHARS: readonly string[] = [
  ..."abcxyzABC019-_.~/%!$&'()*+,;=:@?".split(""),
  "%2e",
  "%2f",
  "%00",
  "%zz",
  "..",
];

const arbPath: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("", "/api", "/api/", "/api/samples/", "/api/health", "/static/", "/api/prove"),
    fc.array(fc.constantFrom(...PATH_CHARS), { maxLength: 12 }),
  )
  .map(([prefix, rest]) => `/${prefix.replace(/^\//, "")}${rest.join("")}`.replace(/^\/\//, "/"));

const arbMethod: fc.Arbitrary<string> = fc.constantFrom("GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS");

const arbHeaderValue: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c)), { maxLength: 40 })
  .map((chars) => chars.join(""));

const arbHeaders: fc.Arbitrary<Record<string, string>> = fc
  .tuple(arbHeaderValue, arbHeaderValue, arbHeaderValue)
  .map(([origin, fuzz, accept]) => ({ Origin: origin, "X-Fuzz": fuzz, Accept: accept }));

describe("security headers on every response", () => {
  let dir: string;
  let app: App;
  let brokenApp: App;
  let port: number;
  let brokenPort: number;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "necro-headers-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    await writeFile(path.join(dir, "app.css"), "body{}");
    app = createApp(makeDeps(dir, false));
    brokenApp = createApp(makeDeps(dir, true));
    port = await listen(app);
    brokenPort = await listen(brokenApp);
  });

  afterAll(async () => {
    await app.shutdown();
    await brokenApp.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  // Feature: necromancer-server, Property 4: Security headers appear on every response
  // **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
  it("sets the security headers and no leaking headers for any method, path and header values", async () => {
    await fc.assert(
      fc.asyncProperty(arbMethod, arbPath, arbHeaders, async (method, requestPath, headers) => {
        const reply = await send(port, method, requestPath, headers);
        expectSecurityHeaders(reply, requestPath);
      }),
      { numRuns: 60 },
    );
  });

  it("covers static, JSON, 404, 405 and 500 responses with the same headers", async () => {
    const cases: readonly { readonly method: string; readonly path: string; readonly status: number; readonly port: number }[] = [
      { method: "GET", path: "/", status: 200, port },
      { method: "GET", path: "/app.css", status: 200, port },
      { method: "GET", path: "/missing.txt", status: 404, port },
      { method: "POST", path: "/", status: 405, port },
      { method: "GET", path: "/api/health", status: 200, port },
      { method: "GET", path: "/api/samples", status: 200, port },
      { method: "GET", path: "/api/samples/interest", status: 200, port },
      { method: "GET", path: "/api/samples/nope", status: 404, port },
      { method: "GET", path: "/api/nope", status: 404, port },
      { method: "DELETE", path: "/api/samples", status: 405, port },
      { method: "GET", path: "/api/prove", status: 405, port },
      { method: "GET", path: "/api/samples", status: 500, port: brokenPort },
      { method: "GET", path: "/api/samples/interest", status: 500, port: brokenPort },
    ];
    for (const c of cases) {
      const reply = await send(c.port, c.method, c.path);
      expect(reply.status, `${c.method} ${c.path}`).toBe(c.status);
      expectSecurityHeaders(reply, c.path);
    }
  });

  it("answers 500 without leaking the catalog failure", async () => {
    const reply = await send(brokenPort, "GET", "/api/samples");
    expect(reply.body).not.toContain("secret");
    expect(reply.body).not.toContain("catalog broke");
  });

  it("answers OPTIONS with 405 on known routes", async () => {
    for (const p of ["/", "/app.css", "/api/health", "/api/samples", "/api/samples/interest", "/api/prove"]) {
      const reply = await send(port, "OPTIONS", p, { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" });
      expect(reply.status, p).toBe(405);
      expectSecurityHeaders(reply, p);
    }
  });
});
