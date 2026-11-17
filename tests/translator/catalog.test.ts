import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  "payroll-hours-pic": ["PIC 9(3)V9", "WS-HOURS"],
  "tax-brackets": ["WHEN"],
  "tax-evaluate-first-match": ["EVALUATE"],
  "tax-whole-unit-rounding": ["PIC 9(8)", "ROUNDED"],
  "tax-unsigned-income": ["PIC 9(8)", "WS-INCOME"],
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

  it("covers exactly the twelve guarded curses", () => {
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

// ---------- all nine translations ----------

const ALL_VARIANTS: readonly Variant[] = ["correct", "subtle", "naive"];
const NINE: readonly (readonly [SampleId, Variant])[] = IDS.flatMap((id) =>
  ALL_VARIANTS.map((variant) => [id, variant] as const),
);

describe("all nine translations", () => {
  it("has nine distinct records", () => {
    const records = NINE.map(([id, variant]) => getTranslation(id, variant));
    expect(records).toHaveLength(9);
    expect(new Set(records).size).toBe(9);
    records.forEach((record, index) => {
      expect(record.sampleId).toBe(NINE[index]?.[0]);
      expect(record.variant).toBe(NINE[index]?.[1]);
    });
  });

  describe.each(NINE)("%s/%s", (id, variant) => {
    const translation = getTranslation(id, variant);
    const curseIds = getSample(id).curses.map((curse) => curse.id);
    const lines = translation.source.split(/\r\n|\r|\n/);

    it("source equals the file bytes read by the test", () => {
      expect(translation.source).toBe(ownRead(`src/translator/translations/${id}.${variant}.ts`));
    });

    it("has the exact provenance", () => {
      expect(translation.provenance).toEqual({
        label: "Pre-generated with Kiro",
        generatedWith: "Kiro",
        date: "2026-11-12",
      });
    });

    it("has markers naming curses of the same sample on their own lines", () => {
      expect(translation.markers.length).toBeGreaterThan(0);
      for (const marker of translation.markers) {
        expect(curseIds).toContain(marker.curseId);
        expect(lines[marker.line - 1] ?? "").toContain(`CURSE:${marker.curseId}`);
      }
    });

    if (variant === "correct") {
      it("marks every curse of its sample", () => {
        const marked = new Set(translation.markers.map((marker) => marker.curseId));
        for (const curseId of curseIds) expect(marked.has(curseId), curseId).toBe(true);
      });
    }

    if (variant === "subtle") {
      it("has a line with both a CURSE marker and NOT HANDLED", () => {
        const hit = lines.some((line) => /\/\/\s*CURSE:[a-z0-9-]+/.test(line) && line.includes("NOT HANDLED"));
        expect(hit).toBe(true);
      });
    }

    if (variant === "naive") {
      it("states DELIBERATELY WRONG", () => {
        expect(translation.source).toContain("DELIBERATELY WRONG");
      });
    }
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

// ---------- static scans of src/translator ----------

const TRANSLATOR_DIR = fileURLToPath(new URL("../../src/translator/", import.meta.url));

function listTsFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listTsFiles(full));
    else if (entry.name.endsWith(".ts")) found.push(full);
  }
  return found;
}

/** Removes // and block comments, keeping string and template contents. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === "/" && next === "/") {
      while (i < source.length && source.charAt(i) !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source.charAt(j) !== ch) j += source.charAt(j) === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

interface ScannedFile {
  readonly rel: string;
  readonly code: string;
}

interface ImportRef {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function importsOf(code: string): readonly ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*["']([^"']+)["']/g)) {
    refs.push({ specifier: m[3] ?? "", typeOnly: m[2] !== undefined });
  }
  for (const m of code.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    refs.push({ specifier: m[1] ?? "", typeOnly: false });
  }
  return refs;
}

const SCANNED: readonly ScannedFile[] = listTsFiles(TRANSLATOR_DIR)
  .map((full) => ({
    rel: full.slice(TRANSLATOR_DIR.length).split("\\").join("/"),
    code: stripComments(readFileSync(full, "utf8")),
  }))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const isPure = (rel: string): boolean => rel.startsWith("translations/") || rel === "cobol-runtime.ts";

describe("static scans of src/translator", () => {
  it("finds the expected files", () => {
    expect(SCANNED.length).toBeGreaterThanOrEqual(17);
    expect(SCANNED.filter((f) => f.rel.startsWith("translations/")).length).toBeGreaterThanOrEqual(10);
  });

  it("stripComments removes comments and keeps strings", () => {
    const out = stripComments('const a = "x // y"; // process.env\n/* eval( */ const b = 1;');
    expect(out).toContain('"x // y"');
    expect(out).not.toContain("process.env");
    expect(out).not.toContain("eval(");
  });

  it.each(SCANNED.map((f) => f.rel))("%s has no forbidden API, dynamic import or test/oracle import", (rel) => {
    const code = SCANNED.find((f) => f.rel === rel)?.code ?? "";
    expect(code).not.toMatch(
      /\beval\s*\(|new\s+Function\b|\bfetch\s*\(|process\.env|XMLHttpRequest|WebSocket|node:(http|https|net|child_process)/,
    );
    expect(code).not.toMatch(/\bimport\s*\(/);
    for (const ref of importsOf(code)) {
      expect(ref.specifier, `${rel} imports from tests/`).not.toMatch(/(^|\/)tests\//);
      expect(ref.specifier, `${rel} imports from oracle/`).not.toMatch(/(^|\/)oracle\//);
    }
  });

  it.each(["types.ts", "sample-data.ts", "markers.ts", "cobol-runtime.ts"])("%s has no node: import", (rel) => {
    const code = SCANNED.find((f) => f.rel === rel)?.code ?? "";
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/node:/);
  });

  it("translations/** have no node: import", () => {
    for (const file of SCANNED.filter((f) => f.rel.startsWith("translations/"))) {
      expect(file.code, file.rel).not.toMatch(/node:/);
    }
  });

  it.each(SCANNED.filter((f) => isPure(f.rel)).map((f) => f.rel))("%s is plain TypeScript", (rel) => {
    const code = SCANNED.find((f) => f.rel === rel)?.code ?? "";
    const banned: readonly RegExp[] = [
      /next\//,
      /server-only/,
      /client-only/,
      /["']use client["']/,
      /["']use server["']/,
      /\?raw/,
      /\?url/,
      /import\.meta\.glob/,
      /require\.context/,
      /["']@\//,
      /\bprocess\./,
      /\bBuffer\b/,
    ];
    for (const pattern of banned) expect(code, `${rel} matches ${String(pattern)}`).not.toMatch(pattern);
    for (const ref of importsOf(code)) {
      const ok = ref.typeOnly || ref.specifier === "decimal.js" || /^\.{1,2}\/.*\.js$/.test(ref.specifier);
      expect(ok, `${rel} has disallowed import "${ref.specifier}"`).toBe(true);
    }
  });

  it("the only src/equivalence imports are compare.js and descriptors.js", () => {
    const seen = new Set<string>();
    for (const file of SCANNED) {
      for (const ref of importsOf(file.code)) {
        if (!/(^|\/)equivalence\//.test(ref.specifier)) continue;
        expect(ref.specifier, file.rel).toMatch(/\/equivalence\/(compare|descriptors)\.js$/);
        seen.add(ref.specifier.split("/").pop() ?? "");
      }
    }
    expect([...seen].sort()).toEqual(["compare.js", "descriptors.js"]);
  });

  it("oracle.test.ts contains no skip, skipIf, runIf or todo", () => {
    expect(ownRead("tests/translator/oracle.test.ts")).not.toMatch(/\b(skip|skipIf|runIf|todo)\b/);
  });
});
