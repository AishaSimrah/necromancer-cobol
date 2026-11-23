import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SAMPLE_IDS, VARIANTS } from "../../src/translator/index.js";
import { validateProveRequest } from "../../src/server/validate.js";
import type { CaseCountLimits, Validation } from "../../src/server/validate.js";

const LIMITS: CaseCountLimits = { min: 100, default: 1000, max: 2000 };
const ALLOWED = ["sampleId", "variant", "caseCount", "seed"];
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;

function validBody(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { sampleId: "interest", variant: "correct", ...extra };
}

function failureOf(body: unknown, limits: CaseCountLimits = LIMITS): Extract<Validation, { ok: false }> {
  const result = validateProveRequest(body, limits);
  if (result.ok) throw new Error("expected a failure");
  return result;
}

function isInt32(n: unknown): boolean {
  return typeof n === "number" && Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX;
}

/** Own-property object, so `__proto__` becomes a plain data key. */
function ownObject(entries: ReadonlyArray<readonly [string, unknown]>): Record<string, unknown> {
  return Object.fromEntries(entries);
}

const keyArb = fc.oneof(
  fc.constantFrom(...ALLOWED, "__proto__", "constructor", "toString", "hasOwnProperty", "prototype"),
  fc.string({ maxLength: 60 }),
);

const valueArb = fc.oneof(
  fc.jsonValue(),
  fc.constantFrom(...SAMPLE_IDS),
  fc.constantFrom(...VARIANTS),
  fc.integer({ min: -3000, max: 3000 }),
  fc.integer({ min: INT32_MIN - 5, max: INT32_MAX + 5 }),
);

const bodyArb = fc
  .array(fc.tuple(keyArb, valueArb), { maxLength: 6 })
  .map((entries) => ownObject(entries));

describe("validateProveRequest examples", () => {
  it("accepts a minimal body and applies the default case count", () => {
    const result = validateProveRequest(validBody(), LIMITS);
    expect(result).toEqual({
      ok: true,
      value: { sampleId: "interest", variant: "correct", caseCount: 1000, seed: undefined },
    });
  });

  it("accepts boundary case counts and seeds", () => {
    for (const caseCount of [100, 2000]) {
      const r = validateProveRequest(validBody({ caseCount }), LIMITS);
      expect(r.ok && r.value.caseCount).toBe(caseCount);
    }
    for (const seed of [INT32_MIN, INT32_MAX, 0]) {
      const r = validateProveRequest(validBody({ seed }), LIMITS);
      expect(r.ok && r.value.seed).toBe(seed);
    }
  });

  it("normalises seed -0 to 0", () => {
    const r = validateProveRequest(validBody({ seed: -0 }), LIMITS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.is(r.value.seed, 0)).toBe(true);
  });

  it.each([
    ["a string", "1000"],
    ["a float", 150.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["an unsafe integer", 2 ** 53],
    ["99", 99],
    ["2001", 2001],
    ["null", null],
    ["a boolean", true],
  ])("rejects caseCount %s and states the range", (_name, caseCount) => {
    const f = failureOf(validBody({ caseCount }));
    expect(f.status).toBe(400);
    expect(f.code).toBe("invalid_case_count");
    expect(f.message).toContain("caseCount");
    expect(f.message).toContain("100 to 2000");
  });

  it("states the max in force", () => {
    const f = failureOf(validBody({ caseCount: 5000 }), { min: 100, default: 500, max: 4000 });
    expect(f.message).toContain("100 to 4000");
  });

  it.each([
    ["a string", "7"],
    ["a float", 1.5],
    ["NaN", Number.NaN],
    ["2147483648", 2147483648],
    ["-2147483649", -2147483649],
    ["an unsafe integer", 2 ** 53],
    ["null", null],
  ])("rejects seed %s", (_name, seed) => {
    const f = failureOf(validBody({ seed }));
    expect(f.status).toBe(400);
    expect(f.code).toBe("invalid_seed");
    expect(f.message).toContain("seed");
    expect(f.message).toContain("-2147483648");
    expect(f.message).toContain("2147483647");
  });

  it.each([undefined, null, 5, ["interest"], "Interest", "toString"])(
    "rejects sampleId %j",
    (sampleId) => {
      const f = failureOf({ sampleId, variant: "correct" });
      expect(f.code).toBe("invalid_sample_id");
      expect(f.message).toContain("sampleId");
    },
  );

  it.each([undefined, null, 5, "Correct", "constructor"])("rejects variant %j", (variant) => {
    const f = failureOf({ sampleId: "tax", variant });
    expect(f.code).toBe("invalid_variant");
    expect(f.message).toContain("variant");
  });

  it.each([null, 1, "x", [], [1]])("rejects non-object body %j", (body) => {
    const f = failureOf(body);
    expect(f.status).toBe(400);
    expect(f.code).toBe("invalid_body");
  });

  it("names an unknown key", () => {
    const f = failureOf(validBody({ extra: 1 }));
    expect(f.code).toBe("unknown_key");
    expect(f.message).toContain("extra");
  });

  it("names an own __proto__ key as unknown", () => {
    const body = JSON.parse('{"sampleId":"tax","variant":"naive","__proto__":{"x":1}}') as unknown;
    const f = failureOf(body);
    expect(f.code).toBe("unknown_key");
    expect(f.message).toContain("__proto__");
  });

  it("ignores inherited properties", () => {
    const body: Record<string, unknown> = Object.create({ sampleId: "tax", variant: "naive" }) as Record<
      string,
      unknown
    >;
    expect(failureOf(body).code).toBe("invalid_sample_id");
  });

  it("cuts echoed unknown keys to 40 characters", () => {
    const long = "k".repeat(200);
    const f = failureOf(validBody({ [long]: 1 }));
    expect(f.code).toBe("unknown_key");
    expect(f.message).toContain("k".repeat(40));
    expect(f.message).not.toContain("k".repeat(41));
  });
});

describe("validateProveRequest properties", () => {
  // Feature: necromancer-server, Property 2: Prove request validation is total and side-effect free on rejection
  // **Validates: Requirements 7.3, 7.4, 7.5, 7.6, 7.7, 7.8**
  it("is total over arbitrary JSON and keyed objects, and never mutates its input", () => {
    const protoBefore = Object.keys(Object.prototype).length;
    fc.assert(
      fc.property(fc.oneof(fc.jsonValue(), bodyArb), (body) => {
        const snapshot = JSON.stringify(body);
        const result = validateProveRequest(body, LIMITS);

        expect(JSON.stringify(body)).toBe(snapshot);
        expect(Object.keys(Object.prototype).length).toBe(protoBefore);

        if (result.ok) {
          const v = result.value;
          expect(SAMPLE_IDS).toContain(v.sampleId);
          expect(VARIANTS).toContain(v.variant);
          expect(Number.isInteger(v.caseCount)).toBe(true);
          expect(v.caseCount).toBeGreaterThanOrEqual(100);
          expect(v.caseCount).toBeLessThanOrEqual(2000);
          if (v.seed !== undefined) expect(isInt32(v.seed)).toBe(true);
          return;
        }
        expect(result.status).toBe(400);
        expect(result.message.length).toBeGreaterThan(0);
        switch (result.code) {
          case "unknown_key": {
            const bad = Object.keys(body as Record<string, unknown>).find((k) => !ALLOWED.includes(k));
            expect(bad).toBeDefined();
            expect(result.message).toContain(JSON.stringify((bad as string).slice(0, 40)));
            break;
          }
          case "invalid_sample_id":
            expect(result.message).toContain("sampleId");
            break;
          case "invalid_variant":
            expect(result.message).toContain("variant");
            break;
          case "invalid_case_count":
            expect(result.message).toContain("caseCount");
            expect(result.message).toContain("100 to 2000");
            break;
          case "invalid_seed":
            expect(result.message).toContain("seed");
            break;
          case "invalid_body":
            expect(typeof body === "object" && body !== null && !Array.isArray(body)).toBe(false);
            break;
          default:
            throw new Error(`unexpected code ${result.code}`);
        }
      }),
      { numRuns: 500 },
    );
  });

  // Feature: necromancer-server, Property 2: Prove request validation is total and side-effect free on rejection
  // **Validates: Requirements 7.5, 7.6, 7.7, 7.8**
  it("accepts exactly the in-range case counts and int32 seeds", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SAMPLE_IDS),
        fc.constantFrom(...VARIANTS),
        fc.oneof(fc.integer({ min: -50, max: 2100 }), fc.double({ noNaN: false })),
        fc.oneof(fc.constant(undefined), fc.integer({ min: INT32_MIN - 3, max: INT32_MAX + 3 })),
        (sampleId, variant, caseCount, seed) => {
          const body: Record<string, unknown> = { sampleId, variant, caseCount };
          if (seed !== undefined) body.seed = seed;
          const result = validateProveRequest(body, LIMITS);
          const countOk = Number.isInteger(caseCount) && caseCount >= 100 && caseCount <= 2000;
          const seedOk = seed === undefined || isInt32(seed);
          expect(result.ok).toBe(countOk && seedOk);
          if (!result.ok) {
            expect(result.code).toBe(countOk ? "invalid_seed" : "invalid_case_count");
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
