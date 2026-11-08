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
