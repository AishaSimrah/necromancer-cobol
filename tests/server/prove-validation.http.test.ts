import fc from "fast-check";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
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

interface Counters {
  backend: number;
  engine: number;
}

interface SendOptions {
  readonly headers?: Readonly<Record<string, string>>;
  /** Body pieces. Written as separate chunks when `chunked`, else as one body. */
  readonly pieces?: readonly Uint8Array[];
  readonly chunked?: boolean;
}

const HANDLE = { id: "fake" } as unknown as CompiledHandle;
const interestExample = getSample("interest").examples[0];
if (interestExample === undefined) throw new Error("interest sample has no example");
const PROBE_OUTPUT: string = interestExample.output;

const REJECTION_CODES: readonly string[] = [
  "unsupported_media_type",
  "payload_too_large",
  "invalid_json",
  "invalid_body",
  "unknown_key",
  "invalid_sample_id",
  "invalid_variant",
  "invalid_case_count",
  "invalid_seed",
];

const counters: Counters = { backend: 0, engine: 0 };

/** Fake backend whose probe succeeds. Every call is counted. */
const fakeBackend: OracleBackend = {
  compileCobol: () => {
    counters.backend += 1;
    return Promise.resolve(HANDLE);
  },
  runCompiled: () => {
    counters.backend += 1;
    const result: RunResult = { status: "ok", stdout: PROBE_OUTPUT, stderr: "", exitCode: 0, truncated: false, durationMs: 1 };
    return Promise.resolve(result);
  },
  releaseHandle: () => {
    counters.backend += 1;
    return Promise.resolve();
  },
  isCompiledHandle: (value: unknown): value is CompiledHandle => value === HANDLE,
  shutdown: () => Promise.resolve(),
};

/** Fake engine: counts calls and fails, so an accepted request ends as a 200 stream with an error line. */
const fakeEngine = ((): Promise<never> => {
  counters.engine += 1;
  return Promise.reject(new Error("fake engine"));
}) as unknown as typeof runEquivalence;

function makeDeps(staticRoot: string): AppDeps {
  return {
    config: {
      port: 0,
      defaultCaseCount: 1000,
      maxCaseCount: 2000,
      timeBudgetMs: 60_000,
      workRoot: path.join(os.tmpdir(), "necro-prove-validation-work"),
    },
    timings: {
      abortBackstopGraceMs: 50,
      engineExitGraceMs: 50,
      probeTimeoutMs: 500,
      probeMinIntervalMs: 0,
      shutdownDeadlineMs: 500,
    },
    backend: fakeBackend,
    engine: fakeEngine,
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

function send(port: number, method: string, requestPath: string, opts: SendOptions = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: requestPath,
        headers: { ...opts.headers, Connection: "close" },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          settled = true;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
        res.on("error", (err) => {
          if (!settled) reject(err);
        });
      },
    );
    req.on("error", (err) => {
      if (!settled) reject(err);
    });
    const pieces = opts.pieces ?? [];
    if (opts.chunked === true) {
      for (const piece of pieces) req.write(piece);
      req.end();
    } else {
      req.end(Buffer.concat(pieces));
    }
  });
}

function postJson(port: number, body: string): Promise<Reply> {
  return send(port, "POST", "/api/prove", {
    headers: { "Content-Type": "application/json" },
    pieces: [Buffer.from(body, "utf8")],
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expected object");
  return value as Record<string, unknown>;
}

function expectSecurityHeaders(reply: Reply): void {
  const h = reply.headers;
  expect(h["content-security-policy"]).toBe("default-src 'self'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-powered-by"]).toBeUndefined();
  expect(h["server"]).toBeUndefined();
  expect(Object.keys(h).filter((k) => k.startsWith("access-control-"))).toEqual([]);
  expect(h["cache-control"]).toBe("no-store");
}

/** A 4xx JSON error with exactly `{type, code, message}`, never a stream and never a score. */
function expectRejection(reply: Reply, status: number, code: string): Record<string, unknown> {
  expect(reply.status, reply.body).toBe(status);
  expect(reply.headers["content-type"]).toContain("application/json");
  expect(reply.headers["content-type"]).not.toContain("ndjson");
  const body = asRecord(JSON.parse(reply.body) as unknown);
  expect(Object.keys(body).sort()).toEqual(["code", "message", "type"]);
  expect(body["type"]).toBe("error");
  expect(body["code"]).toBe(code);
  expect(typeof body["message"]).toBe("string");
  expect(reply.body).not.toContain("matchScore");
  expectSecurityHeaders(reply);
  return body;
}

/** Asserts no backend or engine call happened, then proves the Run_Slot is free with a valid request. */
async function expectNoSideEffectsAndSlotFree(port: number): Promise<void> {
  expect(counters.backend).toBe(0);
  expect(counters.engine).toBe(0);
  const reply = await postJson(port, JSON.stringify({ sampleId: "interest", variant: "correct" }));
  expect(reply.status, "slot must be free (not 429)").toBe(200);
  expect(reply.headers["content-type"]).toContain("application/x-ndjson");
  expect(counters.engine).toBe(1);
  counters.backend = 0;
  counters.engine = 0;
}

const JSON_TYPES: readonly string[] = [
  "application/json",
  "application/json; charset=utf-8",
  "APPLICATION/JSON;charset=UTF-8",
];

const arbToken: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0x21, max: 0x7e }).map((c) => String.fromCharCode(c)), { minLength: 1, maxLength: 30 })
  .map((chars) => chars.join(""));

/** `undefined` means the header is absent. */
const arbContentType: fc.Arbitrary<string | undefined> = fc.oneof(
  fc.constantFrom(...JSON_TYPES),
  fc.constantFrom(
    "text/plain",
    "application/json5",
    "application/jsonx",
    "application/json; charset=latin1",
    "application/json; boundary=x",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
    "application/ndjson",
  ),
  arbToken,
  fc.constant(undefined),
);

const arbBytes: fc.Arbitrary<Uint8Array> = fc.uint8Array({ maxLength: 3000 });

function splitInto(bytes: Uint8Array, cuts: readonly number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => c % (bytes.length + 1)))].sort((a, b) => a - b);
  const out: Uint8Array[] = [];
  let from = 0;
  for (const p of points) {
    if (p > from) out.push(bytes.subarray(from, p));
    from = Math.max(from, p);
  }
  if (from < bytes.length) out.push(bytes.subarray(from));
  return out;
}

function contentTypeHeader(ct: string | undefined): Record<string, string> {
  return ct === undefined ? {} : { "Content-Type": ct };
}

/** Raw socket request: lets the test send a Content-Length that does not match the bytes. */
function rawExchange(port: number, head: string, body: Uint8Array, closeAfterWrite: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("data", (c: Buffer) => chunks.push(c));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      resolve(Buffer.concat(chunks).toString("latin1"));
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("raw exchange timed out"));
    });
    socket.on("connect", () => {
      socket.write(head);
      socket.write(body);
      if (closeAfterWrite) socket.end();
    });
  });
}

describe("POST /api/prove validation over HTTP", () => {
  let dir: string;
  let app: App;
  let port: number;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "necro-prove-validation-"));
    await writeFile(path.join(dir, "index.html"), "<!doctype html><title>x</title>");
    app = createApp(makeDeps(dir));
    port = await listen(app);
  });

  afterAll(async () => {
    await app.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  // Feature: necromancer-server, Property 2: Prove request validation is total and side-effect free on rejection
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
  it("rejects random bodies, content types and lengths with a 4xx JSON error and no side effects", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbContentType,
        arbBytes,
        fc.boolean(),
        fc.array(fc.nat(4000), { maxLength: 4 }),
        async (contentType, bytes, chunked, cuts) => {
          counters.backend = 0;
          counters.engine = 0;
          const pieces = chunked ? splitInto(bytes, cuts) : [bytes];
          const reply = await send(port, "POST", "/api/prove", {
            headers: contentTypeHeader(contentType),
            pieces,
            chunked,
          });
          expect(reply.status).toBeGreaterThanOrEqual(400);
          expect(reply.status).toBeLessThan(500);
          expect(reply.headers["content-type"]).toContain("application/json");
          expect(reply.headers["content-type"]).not.toContain("ndjson");
          const body = asRecord(JSON.parse(reply.body) as unknown);
          expect(Object.keys(body).sort()).toEqual(["code", "message", "type"]);
          expect(body["type"]).toBe("error");
          expect(REJECTION_CODES).toContain(body["code"]);
          expect(typeof body["message"]).toBe("string");
          expect(reply.body).not.toContain("matchScore");
          expectSecurityHeaders(reply);

          const jsonType = contentType !== undefined && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType.trim());
          if (!jsonType) expect(reply.status).toBe(415);
          else if (bytes.length > 1024) expect(reply.status).toBe(413);

          await expectNoSideEffectsAndSlotFree(port);
        },
      ),
      { numRuns: 50 },
    );
  });

  describe("examples", () => {
    it("answers 415 for a missing or wrong Content-Type, even with an oversize declared length", async () => {
      const body = [Buffer.from("{}")];
      expectRejection(await send(port, "POST", "/api/prove", { pieces: body }), 415, "unsupported_media_type");
      expectRejection(
        await send(port, "POST", "/api/prove", { headers: { "Content-Type": "text/plain" }, pieces: body }),
        415,
        "unsupported_media_type",
      );
      expectRejection(
        await send(port, "POST", "/api/prove", {
          headers: { "Content-Type": "application/json; charset=latin1" },
          pieces: body,
        }),
        415,
        "unsupported_media_type",
      );
      expectRejection(
        await send(port, "POST", "/api/prove", {
          headers: { "Content-Type": "text/plain", "Content-Length": "5000" },
        }),
        415,
        "unsupported_media_type",
      );
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 413 when Content-Length exceeds 1024, without the body being sent", async () => {
      const reply = await send(port, "POST", "/api/prove", {
        headers: { "Content-Type": "application/json", "Content-Length": "1025" },
      });
      expectRejection(reply, 413, "payload_too_large");
      expect(reply.headers["connection"]).toBe("close");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 413 for a chunked body that grows past 1024 bytes", async () => {
      const piece = Buffer.alloc(600, 0x20);
      const reply = await send(port, "POST", "/api/prove", {
        headers: { "Content-Type": "application/json" },
        pieces: [piece, piece, piece],
        chunked: true,
      });
      expectRejection(reply, 413, "payload_too_large");
      expect(reply.headers["connection"]).toBe("close");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("accepts a body of exactly 1024 bytes into validation (400, not 413)", async () => {
      const reply = await postJson(port, " ".repeat(1022) + "{}");
      expectRejection(reply, 400, "invalid_sample_id");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 413 when a lying Content-Length is under the limit but the real body is over it", async () => {
      // A Content-Length above 1024 is caught by header; a lying one cannot exceed the parser's framing,
      // so the over-limit stream is exercised with chunked framing (above) and with an over-limit honest length.
      const reply = await postJson(port, `{"sampleId":"${"a".repeat(1100)}"}`);
      expectRejection(reply, 413, "payload_too_large");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("rejects a Content-Length shorter than the sent bytes with a 400 and no side effects", async () => {
      const head =
        "POST /api/prove HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 5\r\nConnection: close\r\n\r\n";
      const text = await rawExchange(port, head, Buffer.from("{}".padEnd(3000, "x")), true);
      // Node's parser may answer 400 itself for the trailing bytes it reads as a second request.
      expect(text.startsWith("HTTP/1.1 400")).toBe(true);
      expect(text).not.toContain("matchScore");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("leaves no side effects when the client declares a length and then closes early", async () => {
      const head =
        "POST /api/prove HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n";
      const text = await rawExchange(port, head, Buffer.from('{"sampleId":"int'), true);
      expect(text).not.toContain("200 OK");
      expect(text).not.toContain("matchScore");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 400 invalid_json for malformed JSON, invalid UTF-8, arrays, null and scalars", async () => {
      for (const body of ["", "{", "not json", "[]", "null", "42", '"interest"', "true", '{"sampleId":"interest",}']) {
        expectRejection(await postJson(port, body), 400, "invalid_json");
      }
      const badUtf8 = await send(port, "POST", "/api/prove", {
        headers: { "Content-Type": "application/json" },
        pieces: [Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d])],
      });
      expectRejection(badUtf8, 400, "invalid_json");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 400 per bad field", async () => {
      const cases: readonly { readonly body: unknown; readonly code: string }[] = [
        { body: {}, code: "invalid_sample_id" },
        { body: { variant: "correct" }, code: "invalid_sample_id" },
        { body: { sampleId: 1, variant: "correct" }, code: "invalid_sample_id" },
        { body: { sampleId: "Interest", variant: "correct" }, code: "invalid_sample_id" },
        { body: { sampleId: "__proto__", variant: "correct" }, code: "invalid_sample_id" },
        { body: { sampleId: "nope", variant: "correct" }, code: "invalid_sample_id" },
        { body: { sampleId: "interest" }, code: "invalid_variant" },
        { body: { sampleId: "interest", variant: "Correct" }, code: "invalid_variant" },
        { body: { sampleId: "interest", variant: 3 }, code: "invalid_variant" },
        { body: { sampleId: "interest", variant: "constructor" }, code: "invalid_variant" },
        { body: { sampleId: "tax", variant: "naive", caseCount: 99 }, code: "invalid_case_count" },
        { body: { sampleId: "tax", variant: "naive", caseCount: 2001 }, code: "invalid_case_count" },
        { body: { sampleId: "tax", variant: "naive", caseCount: 1000.5 }, code: "invalid_case_count" },
        { body: { sampleId: "tax", variant: "naive", caseCount: "1000" }, code: "invalid_case_count" },
        { body: { sampleId: "tax", variant: "naive", caseCount: null }, code: "invalid_case_count" },
        { body: { sampleId: "tax", variant: "naive", caseCount: -100 }, code: "invalid_case_count" },
        { body: { sampleId: "payroll", variant: "subtle", seed: 2147483648 }, code: "invalid_seed" },
        { body: { sampleId: "payroll", variant: "subtle", seed: -2147483649 }, code: "invalid_seed" },
        { body: { sampleId: "payroll", variant: "subtle", seed: 1.5 }, code: "invalid_seed" },
        { body: { sampleId: "payroll", variant: "subtle", seed: "7" }, code: "invalid_seed" },
        { body: { sampleId: "payroll", variant: "subtle", seed: null }, code: "invalid_seed" },
      ];
      for (const c of cases) {
        expectRejection(await postJson(port, JSON.stringify(c.body)), 400, c.code);
      }
      expectRejection(await postJson(port, '{"sampleId":"tax","variant":"naive","caseCount":1e999}'), 400, "invalid_case_count");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 400 unknown_key and names the key", async () => {
      for (const key of ["extra", "candidate", "SampleId", "caseCount ", "x".repeat(200)]) {
        const reply = await postJson(port, JSON.stringify({ sampleId: "interest", variant: "correct", [key]: 1 }));
        const body = expectRejection(reply, 400, "unknown_key");
        expect(String(body["message"])).toContain(JSON.stringify(key.slice(0, 40)));
      }
      const proto = await postJson(port, '{"__proto__":{"a":1},"sampleId":"interest","variant":"correct"}');
      expectRejection(proto, 400, "unknown_key");
      await expectNoSideEffectsAndSlotFree(port);
    });

    // Spec text says 404 for an unknown sample id; design.md and the code answer 400 on POST /api/prove.
    it("answers 400 (not 404) for an unknown sample id and variant on POST /api/prove", async () => {
      expectRejection(await postJson(port, '{"sampleId":"missing","variant":"correct"}'), 400, "invalid_sample_id");
      expectRejection(await postJson(port, '{"sampleId":"interest","variant":"missing"}'), 400, "invalid_variant");
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("answers 405 with Allow: POST for other methods", async () => {
      for (const method of ["GET", "HEAD", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        const reply = await send(port, method, "/api/prove", {
          headers: { "Content-Type": "application/json" },
          pieces: method === "GET" || method === "HEAD" ? [] : [Buffer.from("{}")],
        });
        expect(reply.status, method).toBe(405);
        expect(reply.headers["allow"], method).toBe("POST");
        expectSecurityHeaders(reply);
        if (method !== "HEAD") {
          const body = asRecord(JSON.parse(reply.body) as unknown);
          expect(body["code"]).toBe("method_not_allowed");
        }
      }
      await expectNoSideEffectsAndSlotFree(port);
    });

    it("accepts a valid request and streams (the rejection paths above did not take the slot)", async () => {
      const reply = await postJson(port, '{"sampleId":"tax","variant":"naive","caseCount":100,"seed":-1}');
      expect(reply.status).toBe(200);
      expect(reply.headers["content-type"]).toContain("application/x-ndjson");
      counters.backend = 0;
      counters.engine = 0;
    });
  });
});
