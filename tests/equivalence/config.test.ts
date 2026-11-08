import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EquivalenceConfigError, resolveConfig, type EquivalenceOptions } from "../../src/equivalence/config.js";
import { INTEREST, PAYROLL, TAX, validateDescriptors, type FieldDescriptor } from "../../src/equivalence/descriptors.js";

const candidate = (): string => "";

function opts(extra: Partial<EquivalenceOptions> = {}): EquivalenceOptions {
  return { source: "", fields: INTEREST, candidate, ...extra };
}

function field(extra: Partial<FieldDescriptor>): FieldDescriptor {
  return { name: "x", digits: 3, scale: 0, signed: false, ...extra };
}

describe("resolveConfig", () => {
  it("applies defaults", () => {
    const cfg = resolveConfig(opts());
    expect(cfg.caseCount).toBe(1000);
    expect(cfg.mismatchListCap).toBe(25);
    expect(cfg.shrinkLimit).toBe(200);
    expect(cfg.timeBudgetMs).toBeUndefined();
  });

  it("keeps a given seed", () => {
    expect(resolveConfig(opts({ seed: 1 })).seed).toBe(1);
  });

  it("picks an int32 seed when none is supplied", () => {
    const seed = resolveConfig(opts()).seed;
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(-2147483648);
    expect(seed).toBeLessThanOrEqual(2147483647);
  });

  const bad: ReadonlyArray<readonly [string, Partial<EquivalenceOptions>]> = [
    ["caseCount", { caseCount: 0 }],
    ["caseCount", { caseCount: 100001 }],
    ["caseCount", { caseCount: 1.5 }],
    ["seed", { seed: 2147483648 }],
    ["seed", { seed: -2147483649 }],
    ["seed", { seed: 0.5 }],
    ["timeBudgetMs", { timeBudgetMs: 0 }],
    ["timeBudgetMs", { timeBudgetMs: 3600001 }],
    ["mismatchListCap", { mismatchListCap: 0 }],
    ["mismatchListCap", { mismatchListCap: 10001 }],
    ["shrinkLimit", { shrinkLimit: 0 }],
    ["shrinkLimit", { shrinkLimit: 10001 }],
  ];

  it.each(bad)("rejects bad %s", (name, extra) => {
    const run = (): unknown => resolveConfig(opts(extra));
    expect(run).toThrow(EquivalenceConfigError);
    expect(run).toThrow(name);
  });

  it("accepts boundary values", () => {
    expect(() =>
      resolveConfig(opts({ caseCount: 1, seed: -2147483648, timeBudgetMs: 3600000, mismatchListCap: 10000, shrinkLimit: 1 })),
    ).not.toThrow();
  });

  it("validates descriptors before options", () => {
    expect(() => resolveConfig(opts({ fields: [], caseCount: 0 }))).toThrow(/fields/);
  });
});

describe("validateDescriptors", () => {
  it("accepts INTEREST, PAYROLL and TAX", () => {
    for (const fields of [INTEREST, PAYROLL, TAX]) {
      expect(() => validateDescriptors(fields)).not.toThrow();
    }
  });

  it("rejects an empty list", () => {
    expect(() => validateDescriptors([])).toThrow(EquivalenceConfigError);
  });

  it.each([0, -1, 19, 1.5])("rejects digits %s and names the field", (digits) => {
    const run = (): void => validateDescriptors([field({ digits })]);
    expect(run).toThrow(EquivalenceConfigError);
    expect(run).toThrow(/"x" digits/);
  });

  it.each([-1, 19, 0.5])("rejects scale %s and names the field", (scale) => {
    const run = (): void => validateDescriptors([field({ scale })]);
    expect(run).toThrow(EquivalenceConfigError);
    expect(run).toThrow(/"x" scale/);
  });

  it("rejects duplicate names and more than 20 fields", () => {
    expect(() => validateDescriptors([field({}), field({})])).toThrow(/duplicate/);
    const many = Array.from({ length: 21 }, (_, i) => field({ name: `f${i}` }));
    expect(() => validateDescriptors(many)).toThrow(EquivalenceConfigError);
  });
});

describe("sample descriptor constants", () => {
  it("match the COBOL sample PIC clauses", () => {
    expect(INTEREST).toEqual([
      { name: "principal", digits: 7, scale: 2, signed: false },
      { name: "rate", digits: 3, scale: 2, signed: false },
      { name: "years", digits: 2, scale: 0, signed: false },
    ]);
    expect(PAYROLL).toEqual([
      { name: "hours", digits: 3, scale: 1, signed: false },
      { name: "rate", digits: 3, scale: 2, signed: false },
    ]);
    expect(TAX).toEqual([{ name: "income", digits: 8, scale: 0, signed: false }]);
  });
});

const NUM_RUNS = 200;

const validField = (name: string): fc.Arbitrary<FieldDescriptor> =>
  fc.record({
    name: fc.constant(name),
    digits: fc.integer({ min: 1, max: 18 }),
    scale: fc.integer({ min: 0, max: 18 }),
    signed: fc.boolean(),
  });

const validFields: fc.Arbitrary<readonly FieldDescriptor[]> = fc
  .integer({ min: 1, max: 20 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => validField(`f${i}`))));

const badInt = (min: number, max: number): fc.Arbitrary<number> =>
  fc.oneof(
    fc.integer({ min: min - 1000, max: min - 1 }),
    fc.integer({ min: max + 1, max: max + 1000 }),
    fc.double({ min, max, noNaN: true }).filter((v) => !Number.isInteger(v)),
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  );

const validOptions: fc.Arbitrary<Partial<EquivalenceOptions>> = fc.record(
  {
    caseCount: fc.integer({ min: 1, max: 100000 }),
    seed: fc.integer({ min: -2147483648, max: 2147483647 }),
    timeBudgetMs: fc.integer({ min: 1, max: 3600000 }),
    mismatchListCap: fc.integer({ min: 1, max: 10000 }),
    shrinkLimit: fc.integer({ min: 1, max: 10000 }),
  },
  { requiredKeys: [] },
);

describe("Property 1: invalid configuration is rejected", () => {
  // Feature: equivalence-engine, Property 1: Invalid configuration is rejected before the Oracle is touched
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15**
  const expectRejected = (options: EquivalenceOptions, needle: string | RegExp): void => {
    let caught: unknown;
    try {
      resolveConfig(options);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EquivalenceConfigError);
    expect((caught as Error).message).toMatch(needle);
  };

  it("rejects more than 20 fields", () => {
    fc.assert(
      fc.property(fc.integer({ min: 21, max: 40 }), (n) => {
        const fields = Array.from({ length: n }, (_, i) => field({ name: `f${i}` }));
        expectRejected(opts({ fields }), /fields/);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects duplicate names, naming the offending field", () => {
    fc.assert(
      fc.property(validFields, fc.nat(), (fields, k) => {
        fc.pre(fields.length >= 2);
        const dupIndex = 1 + (k % (fields.length - 1));
        const first = fields[0] as FieldDescriptor;
        const dup = fields.map((f, i) => (i === dupIndex ? { ...f, name: first.name } : f));
        expectRejected(opts({ fields: dup }), new RegExp(`duplicate field name "${first.name}"`));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects digits outside 1..18 or non-integer, naming the field", () => {
    fc.assert(
      fc.property(validFields, fc.nat(), badInt(1, 18), (fields, k, digits) => {
        const idx = k % fields.length;
        const bad = fields.map((f, i) => (i === idx ? { ...f, digits } : f));
        const name = (fields[idx] as FieldDescriptor).name;
        expectRejected(opts({ fields: bad }), new RegExp(`field "${name}" digits`));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("rejects scale outside 0..18 or non-integer, naming the field", () => {
    fc.assert(
      fc.property(validFields, fc.nat(), badInt(0, 18), (fields, k, scale) => {
        const idx = k % fields.length;
        const bad = fields.map((f, i) => (i === idx ? { ...f, scale } : f));
        const name = (fields[idx] as FieldDescriptor).name;
        expectRejected(opts({ fields: bad }), new RegExp(`field "${name}" scale`));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  const settings: ReadonlyArray<readonly [keyof EquivalenceOptions, number, number]> = [
    ["caseCount", 1, 100000],
    ["seed", -2147483648, 2147483647],
    ["timeBudgetMs", 1, 3600000],
    ["mismatchListCap", 1, 10000],
    ["shrinkLimit", 1, 10000],
  ];

  it.each(settings)("rejects out-of-range or non-integer %s, naming the setting", (name, min, max) => {
    fc.assert(
      fc.property(badInt(min, max), (value) => {
        expectRejected(opts({ [name]: value }), new RegExp(name));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

describe("Property 2: valid configuration is accepted", () => {
  // Feature: equivalence-engine, Property 2: Valid configuration is accepted
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 8.6, 9.1, 9.2, 9.3, 9.4, 9.8, 9.9, 9.10, 9.14, 9.15**
  it("accepts valid descriptors and options and echoes the values", () => {
    fc.assert(
      fc.property(validFields, validOptions, (fields, extra) => {
        const cfg = resolveConfig(opts({ fields, ...extra }));
        expect(cfg.fields).toBe(fields);
        expect(cfg.caseCount).toBe(extra.caseCount ?? 1000);
        expect(cfg.mismatchListCap).toBe(extra.mismatchListCap ?? 25);
        expect(cfg.shrinkLimit).toBe(extra.shrinkLimit ?? 200);
        expect(cfg.timeBudgetMs).toBe(extra.timeBudgetMs);
        if (extra.seed !== undefined) {
          expect(cfg.seed).toBe(extra.seed);
        } else {
          expect(Number.isInteger(cfg.seed)).toBe(true);
          expect(cfg.seed).toBeGreaterThanOrEqual(-2147483648);
          expect(cfg.seed).toBeLessThanOrEqual(2147483647);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
