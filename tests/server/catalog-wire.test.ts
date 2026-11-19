import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { toSampleDetail, toSampleSummary } from "../../src/server/catalog-wire.js";
import type { Sample, Translation, Variant } from "../../src/translator/types.js";

const SUMMARY_KEYS = ["defaultInput", "id", "name", "trapLabel"];
const DETAIL_KEYS = [
  "cobolSource",
  "curses",
  "defaultInput",
  "examples",
  "fidelityPact",
  "fields",
  "id",
  "name",
  "translations",
  "trapLabel",
];
const FIELD_KEYS = ["digits", "name", "scale", "signed"];
const CURSE_KEYS = ["id", "label", "lines"];
const EXAMPLE_KEYS = ["input", "output"];
const TRANSLATION_KEYS = ["markers", "provenance", "source", "variant"];
const PROVENANCE_KEYS = ["date", "generatedWith", "label"];
const MARKER_KEYS = ["curseId", "line"];

type Rec = Record<string, unknown>;

/** Extra enumerable properties: unknown keys, `candidate`, and functions. */
const extras: fc.Arbitrary<Rec> = fc
  .dictionary(
    fc.stringMatching(/^x_[a-z]{1,6}$/),
    fc.oneof(
      fc.constant(() => 1),
      fc.constant(function named(): string {
        return "x";
      }),
      fc.string(),
      fc.integer(),
    ),
    { maxKeys: 3 },
  )
  .chain((d) =>
    fc.boolean().map((withCandidate) => {
      const out: Rec = { ...d };
      if (withCandidate) out.candidate = (): string => "leak";
      return out;
    }),
  );

function withExtras<T extends Rec>(base: fc.Arbitrary<T>): fc.Arbitrary<T> {
  return fc.tuple(base, extras).map(([b, e]) => ({ ...e, ...b }));
}

const text = fc.string({ maxLength: 20 });
const lines = fc.array(fc.integer({ min: 1, max: 200 }), { maxLength: 4 });

const fieldArb = withExtras(
  fc.record({
    name: text,
    digits: fc.integer({ min: 1, max: 18 }),
    scale: fc.integer({ min: 0, max: 9 }),
    signed: fc.boolean(),
  }),
);
const curseArb = withExtras(fc.record({ id: text, label: text, lines }));
const exampleArb = withExtras(
  fc.record({ input: fc.array(text, { maxLength: 4 }), output: text }),
);

const sampleArb: fc.Arbitrary<Sample> = withExtras(
  fc.record({
    id: fc.constantFrom("interest", "payroll", "tax"),
    name: fc.constantFrom("INTEREST", "PAYROLL", "TAX"),
    trapLabel: text,
    fields: fc.array(fieldArb, { maxLength: 4 }),
    defaultInput: fc.array(text, { maxLength: 4 }),
    examples: fc.array(exampleArb, { maxLength: 3 }),
    fidelityPact: fc.array(text, { maxLength: 4 }),
    curses: fc.array(curseArb, { maxLength: 3 }),
    cobolSource: text,
  }),
).map((s) => s as unknown as Sample);

function translationArb(variant: Variant): fc.Arbitrary<Translation> {
  const provenance = withExtras(
    fc.record({
      label: fc.constant("Pre-generated with Kiro"),
      generatedWith: fc.constant("Kiro"),
      date: fc.constant("2025-01-01"),
    }),
  );
  const marker = withExtras(fc.record({ curseId: text, line: fc.integer({ min: 1, max: 200 }) }));
  return withExtras(
    fc.record({
      sampleId: fc.constantFrom("interest", "payroll", "tax"),
      variant: fc.constant(variant),
      source: text,
      provenance,
      markers: fc.array(marker, { maxLength: 3 }),
    }),
  ).map((t) => ({ ...t, candidate: (): string => "leak" }) as unknown as Translation);
}

/** The three translations in a shuffled order. */
const translationsArb: fc.Arbitrary<Translation[]> = fc
  .tuple(translationArb("correct"), translationArb("subtle"), translationArb("naive"))
  .chain((t) => fc.shuffledSubarray(t, { minLength: 3, maxLength: 3 }).map((a) => [...a]));

function sortedKeys(o: unknown): string[] {
  return Object.keys(o as Rec).sort();
}

function containsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => containsKey(v, key));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Rec).some(([k, v]) => k === key || containsKey(v, key));
  }
  return false;
}

function containsFunction(value: unknown): boolean {
  if (typeof value === "function") return true;
  if (Array.isArray(value)) return value.some(containsFunction);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Rec).some(containsFunction);
  }
  return false;
}

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("catalog-wire allowlist", () => {
  // Feature: necromancer-server, Property 6: Sample responses are allowlisted data
  // Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 13.4
  it("toSampleSummary emits exactly the documented keys", () => {
    fc.assert(
      fc.property(sampleArb, (sample) => {
        const out = toSampleSummary(sample);
        expect(sortedKeys(out)).toEqual(SUMMARY_KEYS);
        expect(containsFunction(out)).toBe(false);
        expect(containsFunction(roundTrip(out))).toBe(false);
        expect(containsKey(out, "candidate")).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: necromancer-server, Property 6: Sample responses are allowlisted data
  // Validates: Requirements 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 13.4
  it("toSampleDetail emits exactly the documented keys at every level", () => {
    fc.assert(
      fc.property(sampleArb, translationsArb, (sample, translations) => {
        const out = toSampleDetail(sample, translations);
        const wire = roundTrip(out) as {
          fields: unknown[];
          curses: unknown[];
          examples: unknown[];
          translations: { provenance: unknown; markers: unknown[] }[];
        };
        expect(sortedKeys(out)).toEqual(DETAIL_KEYS);
        for (const f of out.fields) expect(sortedKeys(f)).toEqual(FIELD_KEYS);
        for (const c of out.curses) expect(sortedKeys(c)).toEqual(CURSE_KEYS);
        for (const e of out.examples) expect(sortedKeys(e)).toEqual(EXAMPLE_KEYS);
        for (const t of out.translations) {
          expect(sortedKeys(t)).toEqual(TRANSLATION_KEYS);
          expect(sortedKeys(t.provenance)).toEqual(PROVENANCE_KEYS);
          for (const m of t.markers) expect(sortedKeys(m)).toEqual(MARKER_KEYS);
        }
        expect(containsFunction(wire)).toBe(false);
        expect(containsKey(out, "candidate")).toBe(false);
        expect(containsKey(wire, "candidate")).toBe(false);
        expect(JSON.stringify(wire)).not.toContain("leak");
      }),
      { numRuns: 100 },
    );
  });

  // Feature: necromancer-server, Property 6: Sample responses are allowlisted data
  // Validates: Requirements 5.3, 6.3
  it("orders translations correct, subtle, naive regardless of input order", () => {
    fc.assert(
      fc.property(sampleArb, translationsArb, (sample, translations) => {
        const out = toSampleDetail(sample, translations);
        expect(out.translations.map((t) => t.variant)).toEqual(["correct", "subtle", "naive"]);
      }),
      { numRuns: 100 },
    );
  });

  it("returns empty-safe output for a sample with no translations", () => {
    const sample = {
      id: "tax",
      name: "TAX",
      trapLabel: "t",
      fields: [],
      defaultInput: [],
      examples: [],
      fidelityPact: [],
      curses: [],
      cobolSource: "",
    } as unknown as Sample;
    expect(toSampleDetail(sample, []).translations).toEqual([]);
  });
});
