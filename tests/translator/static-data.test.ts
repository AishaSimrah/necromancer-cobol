import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INTEREST, PAYROLL, TAX } from "../../src/equivalence/descriptors.js";
import { extractCurseMarkers } from "../../src/translator/markers.js";
import { SAMPLE_DATA } from "../../src/translator/sample-data.js";
import { SAMPLE_IDS } from "../../src/translator/types.js";
import type { SampleData } from "../../src/translator/types.js";

const ALL: readonly SampleData[] = SAMPLE_IDS.map((id) => SAMPLE_DATA[id]);

describe("SAMPLE_DATA basics", () => {
  it("lists ids in the order interest, payroll, tax", () => {
    expect([...SAMPLE_IDS]).toEqual(["interest", "payroll", "tax"]);
    expect(Object.keys(SAMPLE_DATA)).toEqual(["interest", "payroll", "tax"]);
    expect(ALL.map((s) => s.id)).toEqual(["interest", "payroll", "tax"]);
    expect(ALL.map((s) => s.name)).toEqual(["INTEREST", "PAYROLL", "TAX"]);
  });

  it("uses copies of the descriptor arrays and leaves the originals unfrozen", () => {
    const pairs = [
      [SAMPLE_DATA.interest.fields, INTEREST],
      [SAMPLE_DATA.payroll.fields, PAYROLL],
      [SAMPLE_DATA.tax.fields, TAX],
    ] as const;
    for (const [copy, original] of pairs) {
      expect(copy).toEqual(original);
      expect(copy).not.toBe(original);
      expect(Object.isFrozen(original)).toBe(false);
    }
  });

  it("has a default input that is one of the examples with one line per field", () => {
    for (const sample of ALL) {
      expect(sample.examples.some((e) => JSON.stringify(e.input) === JSON.stringify(sample.defaultInput))).toBe(true);
      expect(sample.defaultInput).toHaveLength(sample.fields.length);
    }
  });

  it("has a pact of 3 to 4 entries of at most 80 characters", () => {
    for (const sample of ALL) {
      expect(sample.fidelityPact.length).toBeGreaterThanOrEqual(3);
      expect(sample.fidelityPact.length).toBeLessThanOrEqual(4);
      for (const entry of sample.fidelityPact) {
        expect(entry.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("has trap labels without line breaks", () => {
    for (const sample of ALL) {
      expect(sample.trapLabel).not.toMatch(/[\r\n]/);
      expect(sample.trapLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("curses", () => {
  const curses = ALL.flatMap((s) => s.curses);

  it("has unique ids that match /^[a-z0-9-]+$/", () => {
    const ids = curses.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(10);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has labels of at most 32 characters", () => {
    for (const curse of curses) {
      expect(curse.label.length).toBeGreaterThan(0);
      expect(curse.label.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("freezing", () => {
  it("freezes the record, arrays and curses", () => {
    expect(Object.isFrozen(SAMPLE_DATA)).toBe(true);
    for (const sample of ALL) {
      expect(Object.isFrozen(sample)).toBe(true);
      expect(Object.isFrozen(sample.fields)).toBe(true);
      expect(Object.isFrozen(sample.defaultInput)).toBe(true);
      expect(Object.isFrozen(sample.examples)).toBe(true);
      expect(Object.isFrozen(sample.fidelityPact)).toBe(true);
      expect(Object.isFrozen(sample.curses)).toBe(true);
      for (const curse of sample.curses) {
        expect(Object.isFrozen(curse)).toBe(true);
        expect(Object.isFrozen(curse.lines)).toBe(true);
      }
    }
  });

  it("leaves the exported descriptor arrays unfrozen", () => {
    expect(Object.isFrozen(INTEREST)).toBe(false);
    expect(Object.isFrozen(PAYROLL)).toBe(false);
    expect(Object.isFrozen(TAX)).toBe(false);
  });
});

describe("extractCurseMarkers", () => {
  it("finds a single marker", () => {
    expect(extractCurseMarkers("a\nb // CURSE:interest-overflow\nc")).toEqual([
      { curseId: "interest-overflow", line: 2 },
    ]);
  });

  it("finds two markers on one line", () => {
    expect(extractCurseMarkers("x // CURSE:one // CURSE:two")).toEqual([
      { curseId: "one", line: 1 },
      { curseId: "two", line: 1 },
    ]);
  });

  it("returns nothing when there is no marker", () => {
    expect(extractCurseMarkers("const a = 1;\n// CURSE without colon\n")).toEqual([]);
  });

  it("accepts ids with digits and hyphens", () => {
    expect(extractCurseMarkers("// CURSE:a1-b2-3")).toEqual([{ curseId: "a1-b2-3", line: 1 }]);
  });

  it("numbers lines from 1 and handles CRLF", () => {
    expect(extractCurseMarkers("// CURSE:first\r\n\r\n// CURSE:third")).toEqual([
      { curseId: "first", line: 1 },
      { curseId: "third", line: 3 },
    ]);
  });

  it("property: a marker inserted at line N is reported at line N", () => {
    const filler = fc.stringMatching(/^[a-z =;]{0,20}$/);
    const arb = fc
      .tuple(fc.array(filler, { maxLength: 30 }), fc.stringMatching(/^[a-z0-9-]{1,12}$/))
      .chain(([lines, id]) =>
        fc.nat({ max: lines.length }).map((at) => ({ lines, id, at })),
      );
    fc.assert(
      fc.property(arb, ({ lines, id, at }) => {
        const all = [...lines];
        all.splice(at, 0, `const x = 1; // CURSE:${id}`);
        const markers = extractCurseMarkers(all.join("\n"));
        expect(markers).toEqual([{ curseId: id, line: at + 1 }]);
      }),
      { numRuns: 200, seed: 20260101 },
    );
  });
});
