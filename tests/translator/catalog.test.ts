import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INTEREST, PAYROLL, TAX } from "../../src/equivalence/descriptors.js";
import type { FieldDescriptor } from "../../src/equivalence/descriptors.js";
import { getSample, getTranslation, listSamples } from "../../src/translator/catalog.js";
import type { ExamplePair, Sample, SampleId, Variant } from "../../src/translator/types.js";

function ownRead(relative: string): string {
  return readFileSync(fileURLToPath(new URL("../../" + relative, import.meta.url)), "utf8");
}

const IDS: readonly SampleId[] = ["interest", "payroll", "tax"];

// ---------- EXPECTED.md parsing ----------

function sectionOf(markdown: string, id: SampleId): readonly string[] {
  const lines = markdown.split(/\r\n|\r|\n/);
  const start = lines.findIndex((line) => line.startsWith(`## ${id}.cbl`));
  if (start < 0) throw new Error(`EXPECTED.md has no section for ${id}.cbl`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return end < 0 ? rest : rest.slice(0, end);
}

function parseExpected(markdown: string, id: SampleId): readonly ExamplePair[] {
  const pairs: ExamplePair[] = [];
  for (const line of sectionOf(markdown, id)) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const inputCell = cells[1];
    const outputCell = cells[2];
    if (inputCell === undefined || outputCell === undefined) continue;
    if (inputCell === "Input" || /^-+$/.test(inputCell)) continue;
    const segments = [...outputCell.matchAll(/`([^`]*)`/g)].map((m) => m[1] ?? "");
    pairs.push({
      input: inputCell.split(" / ").map((part) => part.trim()),
      output: segments.join("\n") + "\n",
    });
  }
  return pairs;
}

// ---------- listSamples / getSample ----------

describe("listSamples and getSample", () => {
  it("lists interest, payroll, tax in order", () => {
    expect(listSamples().map((sample) => sample.id)).toEqual(["interest", "payroll", "tax"]);
  });

  it.each(IDS)("%s cobolSource equals the file read by the test", (id) => {
    expect(getSample(id).cobolSource).toBe(ownRead(`cobol-samples/${id}.cbl`));
  });
});

// ---------- examples vs EXPECTED.md ----------

describe("examples match cobol-samples/EXPECTED.md", () => {
  const markdown = ownRead("cobol-samples/EXPECTED.md");
  const expectedCounts: Readonly<Record<SampleId, number>> = { interest: 3, payroll: 2, tax: 3 };

  it.each(IDS)("%s examples equal the parsed table rows", (id) => {
    const parsed = parseExpected(markdown, id);
    expect(parsed).toHaveLength(expectedCounts[id]);
    expect(getSample(id).examples).toEqual(parsed);
  });
});

// ---------- curses ----------

const KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  "interest-yearly-rounding": ["ROUNDED", "PERFORM VARYING"],
  "interest-overflow": ["PIC 9(7)V99", "ROUNDED"],
  "interest-years-pic99": ["PIC 99", "WS-YEARS"],
  "payroll-overtime": ["> 40", "1.5"],
  "payroll-compute-rounding": ["ROUNDED"],
  "payroll-deduct-truncated": ["0.0765"],
  "payroll-z-format": ["PIC Z(5)9.99", "DISPLAY"],
  "tax-brackets": ["WHEN"],
  "tax-evaluate-first-match": ["EVALUATE"],
  "tax-whole-unit-rounding": ["PIC 9(8)", "ROUNDED"],
};

describe("curses", () => {
  const allCurses = listSamples().flatMap((sample) =>
    sample.curses.map((curse) => ({ sample, curse })),
  );

  it("has unique ids matching /^[a-z0-9-]+$/", () => {
    const ids = allCurses.map(({ curse }) => curse.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("has labels of at most 32 characters", () => {
    for (const { curse } of allCurses) {
      expect(curse.label.length).toBeGreaterThan(0);
      expect(curse.label.length).toBeLessThanOrEqual(32);
    }
  });

  it("has in-range, non-blank line numbers", () => {
    for (const { sample, curse } of allCurses) {
      const lines = sample.cobolSource.split(/\r\n|\r|\n/);
      expect(curse.lines.length).toBeGreaterThan(0);
      for (const lineNo of curse.lines) {
        expect(Number.isInteger(lineNo)).toBe(true);
        expect(lineNo).toBeGreaterThanOrEqual(1);
        expect(lineNo).toBeLessThanOrEqual(lines.length);
        expect((lines[lineNo - 1] ?? "").trim()).not.toBe("");
      }
    }
  });

  it("covers exactly the ten guarded curses", () => {
    expect(allCurses.map(({ curse }) => curse.id).sort()).toEqual(Object.keys(KEYWORDS).sort());
  });

  it.each(Object.entries(KEYWORDS))("%s has a line containing one of its keywords", (id, words) => {
    const found = allCurses.find(({ curse }) => curse.id === id);
    if (found === undefined) throw new Error(`curse ${id} missing from catalog`);
    const lines = found.sample.cobolSource.split(/\r\n|\r|\n/);
    const hit = found.curse.lines.some((lineNo) => {
      const text = lines[lineNo - 1] ?? "";
      return words.some((word) => text.includes(word));
    });
    expect(hit).toBe(true);
  });
});

// ---------- getTranslation("interest", "correct") ----------

describe('getTranslation("interest", "correct")', () => {
  const translation = getTranslation("interest", "correct");
  const interest = getSample("interest");

  it("source equals the file bytes read by the test", () => {
    expect(translation.source).toBe(ownRead("src/translator/translations/interest.correct.ts"));
  });

  it("has the exact provenance and an ISO date", () => {
    const { date, ...rest } = translation.provenance;
    expect(rest).toEqual({ label: "Pre-generated with Kiro", generatedWith: "Kiro" });
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
  });

  it("has markers that reference interest curses on their own source lines", () => {
    const curseIds = interest.curses.map((curse) => curse.id);
    const lines = translation.source.split(/\r\n|\r|\n/);
    expect(translation.markers.length).toBeGreaterThan(0);
    for (const marker of translation.markers) {
      expect(curseIds).toContain(marker.curseId);
      expect(lines[marker.line - 1] ?? "").toContain(`CURSE:${marker.curseId}`);
    }
  });

  it("marks every interest curse at least once", () => {
    const marked = new Set(translation.markers.map((marker) => marker.curseId));
    for (const curse of interest.curses) expect(marked.has(curse.id)).toBe(true);
  });
});

// ---------- API errors ----------

describe("API errors", () => {
  const call = (fn: () => unknown): (() => unknown) => fn;
  const bad = (value: unknown): never => value as never;

  it("rejects an unknown sample id naming it and listing valid ids", () => {
    expect(call(() => getSample(bad("loan")))).toThrow(/"loan"/);
    expect(call(() => getSample(bad("loan")))).toThrow(/interest, payroll, tax/);
    expect(call(() => getTranslation(bad("loan"), "correct"))).toThrow(/"loan"/);
  });

  it("rejects an unknown variant naming it and listing valid variants", () => {
    expect(call(() => getTranslation("interest", bad("fancy")))).toThrow(/"fancy"/);
    expect(call(() => getTranslation("interest", bad("fancy")))).toThrow(
      /correct, subtle, naive/,
    );
  });

  it("rejects non-string values", () => {
    for (const value of [undefined, null, 42, {}, ["interest"]]) {
      expect(call(() => getSample(bad(value)))).toThrow(/Valid ids: interest, payroll, tax/);
      expect(call(() => getTranslation("interest", bad(value)))).toThrow(
        /Valid variants: correct, subtle, naive/,
      );
    }
    expect(call(() => getSample(bad(42)))).toThrow(/"42"/);
  });
});

// ---------- immutability ----------

describe("immutability", () => {
  it("freezes samples, arrays and curses", () => {
    for (const sample of listSamples()) {
      expect(Object.isFrozen(sample)).toBe(true);
      expect(Object.isFrozen(sample.fields)).toBe(true);
      expect(Object.isFrozen(sample.defaultInput)).toBe(true);
      expect(Object.isFrozen(sample.examples)).toBe(true);
      expect(Object.isFrozen(sample.fidelityPact)).toBe(true);
      expect(Object.isFrozen(sample.curses)).toBe(true);
      for (const field of sample.fields) expect(Object.isFrozen(field)).toBe(true);
      for (const example of sample.examples) {
        expect(Object.isFrozen(example)).toBe(true);
        expect(Object.isFrozen(example.input)).toBe(true);
      }
      for (const curse of sample.curses) {
        expect(Object.isFrozen(curse)).toBe(true);
        expect(Object.isFrozen(curse.lines)).toBe(true);
      }
    }
  });

  it("returns the same reference on repeated calls", () => {
    expect(getSample("tax")).toBe(getSample("tax"));
  });

  it("throws TypeError on assignment through a cast", () => {
    const sample = getSample("tax");
    expect(() => {
      (sample as { name: string }).name = "OTHER";
    }).toThrow(TypeError);
    expect(() => {
      (sample.curses as unknown as { id: string }[]).push({ id: "x" });
    }).toThrow(TypeError);
    const first = sample.curses[0];
    if (first === undefined) throw new Error("tax has no curses");
    expect(() => {
      (first as { label: string }).label = "changed";
    }).toThrow(TypeError);
  });

  it("leaves the exported descriptors unfrozen and copies them into the catalog", () => {
    const pairs: readonly (readonly [SampleId, readonly FieldDescriptor[]])[] = [
      ["interest", INTEREST],
      ["payroll", PAYROLL],
      ["tax", TAX],
    ];
    for (const [id, descriptor] of pairs) {
      const sample = getSample(id);
      expect(Object.isFrozen(descriptor)).toBe(false);
      for (const field of descriptor) expect(Object.isFrozen(field)).toBe(false);
      expect(sample.fields).toEqual(descriptor);
      expect(sample.fields).not.toBe(descriptor);
      sample.fields.forEach((field, index) => expect(field).not.toBe(descriptor[index]));
    }
  });
});

// ---------- missing translation ----------

describe("missing translations", () => {
  // Removed in task 13.1, when every sample/variant has a registered translation.
  it("throws for payroll/subtle", () => {
    const variant: Variant = "subtle";
    expect(() => getTranslation("payroll", variant)).toThrow(
      "No translation registered for payroll/subtle",
    );
  });
});

// ---------- sample facts ----------

describe("sample facts", () => {
  it.each(IDS)("%s has a valid pact, trap label and default input", (id) => {
    const sample: Sample = getSample(id);
    expect(sample.fidelityPact.length).toBeGreaterThanOrEqual(3);
    expect(sample.fidelityPact.length).toBeLessThanOrEqual(4);
    for (const entry of sample.fidelityPact) {
      expect(entry.length).toBeGreaterThan(0);
      expect(entry.length).toBeLessThanOrEqual(80);
    }
    expect(sample.trapLabel).not.toMatch(/[\r\n]/);
    expect(sample.defaultInput).toHaveLength(sample.fields.length);
    expect(sample.examples.map((example) => example.input)).toContainEqual(sample.defaultInput);
  });
});
