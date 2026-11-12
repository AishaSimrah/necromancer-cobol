import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as equivalence from "../../src/equivalence/index.js";
import type {
  Candidate,
  EquivalenceOptions,
  EquivalenceReport,
  EvidenceGroup,
  FieldDescriptor,
  OraclePort,
  ProgressCallback,
} from "../../src/equivalence/index.js";
import { createFakeOracle, okResult } from "./doubles/fake-oracle.js";

// Replace the real Oracle module with call-counting stubs so any accidental use is detected.
const realOracleMock = vi.hoisted(() => ({
  compileCobol: vi.fn(),
  runCompiled: vi.fn(),
  releaseHandle: vi.fn(),
  isCompiledHandle: vi.fn(),
  runCobol: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock("../../src/oracle/index.js", () => realOracleMock);

const SRC_DIR = join(process.cwd(), "src", "equivalence");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

const FILES = listTsFiles(SRC_DIR).map((path) => ({
  rel: relative(SRC_DIR, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8"),
}));

/** Module specifiers from `import ... from "x"`, `export ... from "x"`, `import("x")` and `import "x"`. */
function specifiers(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.push(m[1] as string);
  }
  return found;
}

/** Removes comments and string/template literal contents so `any` is only matched in code. */
function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, "``");
}

describe("module boundaries: static scan of src/equivalence", () => {
  it("finds source files to scan", () => {
    expect(FILES.length).toBeGreaterThan(5);
    expect(FILES.map((f) => f.rel)).toContain("oracle-port.ts");
  });

  // Validates: Requirements 12.1, 12.2
  it("imports the Oracle only through its index, and only in oracle-port.ts", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const spec of specifiers(f.text)) {
        if (!/(^|\/)oracle(\/|$)/.test(spec)) continue;
        const isIndex = /(^|\/)oracle\/index(\.js|\.ts)?$/.test(spec);
        if (!isIndex || f.rel !== "oracle-port.ts") offenders.push(`${f.rel}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
    const port = FILES.find((f) => f.rel === "oracle-port.ts");
    const portOracleImports = specifiers(port?.text ?? "").filter((s) => /oracle\//.test(s));
    expect(portOracleImports.length).toBeGreaterThan(0);
  });

  // Validates: Requirements 12.3, 12.4
  it("does not import analyzer, translator or app modules", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      for (const spec of specifiers(f.text)) {
        if (/(^|[\\/@~])(analyzer|translator|app)([\\/]|$)/.test(spec)) {
          offenders.push(`${f.rel}: ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Validates: Requirement 12.5
  it("never uses the `any` type", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const code = stripCommentsAndStrings(f.text);
      if (/\bany\b/.test(code)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("public entry point", () => {
  // Validates: Requirement 12.6
  it("exports the runtime API", () => {
    expect(typeof equivalence.runEquivalence).toBe("function");
    expect(typeof equivalence.EquivalenceConfigError).toBe("function");
    expect(new equivalence.EquivalenceConfigError("x")).toBeInstanceOf(Error);
    for (const d of [equivalence.INTEREST, equivalence.PAYROLL, equivalence.TAX]) {
      expect(Array.isArray(d)).toBe(true);
      expect(d.length).toBeGreaterThan(0);
    }
    expect(equivalence.INTEREST.length).toBe(3);
    expect(equivalence.PAYROLL.length).toBe(2);
    expect(equivalence.TAX.length).toBe(1);
  });

  it("exports the public types (compile-time check)", () => {
    const field: FieldDescriptor = equivalence.TAX[0] as FieldDescriptor;
    const candidate: Candidate = () => "";
    const progress: ProgressCallback = () => undefined;
    const group: EvidenceGroup = "standard computation";
    const oracle: OraclePort = createFakeOracle();
    const options: EquivalenceOptions = {
      source: "",
      fields: [field],
      candidate,
      onProgress: progress,
      oracle,
    };
    const reportKeys: ReadonlyArray<keyof EquivalenceReport> = ["outcome", "matchScore", "seed"];
    expect(options.fields.length).toBe(1);
    expect(group).toBe("standard computation");
    expect(reportKeys.length).toBe(3);
  });
});

describe("injected Oracle isolation", () => {
  // Validates: Requirements 12.2, 12.3
  it("never calls the real Oracle when an Oracle is injected", async () => {
    for (const fn of Object.values(realOracleMock)) fn.mockClear();
    const oracle = createFakeOracle({ run: okResult("OUT") });

    const report = await equivalence.runEquivalence({
      source: "IDENTIFICATION DIVISION.",
      fields: equivalence.TAX,
      candidate: () => "OUT",
      caseCount: 100,
      seed: 7,
      oracle,
    });

    expect(report.matchScore).toBe(1);
    expect(oracle.compileCalls).toBe(1);
    expect(oracle.runCalls).toBeGreaterThan(0);
    expect(oracle.releaseCalls).toBe(1);
    for (const [name, fn] of Object.entries(realOracleMock)) {
      expect(fn, name).not.toHaveBeenCalled();
    }
  });
});
