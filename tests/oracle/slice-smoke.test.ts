import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compileCobol,
  isCompiledHandle,
  releaseHandle,
  runCobol,
  runCompiled,
  shutdown,
  type CompiledHandle,
} from "../../src/oracle/index.js";

/**
 * Slice smoke test against the real Oracle image (Docker required).
 * Expected values come from cobol-samples/EXPECTED.md (GnuCOBOL 3.1.2).
 */

interface Case {
  readonly inputs: readonly string[];
  readonly lines: readonly string[];
}

const SAMPLES: Readonly<Record<string, readonly Case[]>> = {
  interest: [
    { inputs: ["1000", "5", "3"], lines: ["BALANCE:    1157.63"] },
    { inputs: ["1234.56", "7.25", "10"], lines: ["BALANCE:    2485.95"] },
    { inputs: ["9000000", "50", "3"], lines: ["BALANCE: 7875000.00"] },
  ],
  payroll: [
    {
      inputs: ["45", "20.55"],
      lines: ["GROSS:    976.13", "DEDUCT:     74.67", "NET:    901.46"],
    },
    {
      inputs: ["32.5", "18.99"],
      lines: ["GROSS:    617.18", "DEDUCT:     47.21", "NET:    569.97"],
    },
  ],
  tax: [
    { inputs: ["300000"], lines: ["TAX:     2500"] },
    { inputs: ["750000"], lines: ["TAX:    62500"] },
    { inputs: ["2000000"], lines: ["TAX:   412500"] },
  ],
};

function loadSource(name: string): string {
  return readFileSync(resolve(process.cwd(), "cobol-samples", `${name}.cbl`), "utf8");
}

/** Splits stdout into lines, ignoring the final newline. */
function toLines(stdout: string): string[] {
  return stdout.replace(/\r?\n$/, "").split(/\r?\n/);
}

const HANDLES = new Map<string, CompiledHandle>();
const LONG = 120_000;

describe("oracle slice smoke (real image)", () => {
  beforeAll(async () => {
    for (const name of Object.keys(SAMPLES)) {
      const handle = await compileCobol(loadSource(name));
      if (!isCompiledHandle(handle)) {
        throw new Error(`compile of ${name} failed: ${handle.status} ${handle.message ?? ""} ${handle.stderr}`);
      }
      HANDLES.set(name, handle);
    }
  }, LONG * 2);

  afterAll(async () => {
    for (const handle of HANDLES.values()) await releaseHandle(handle);
    await shutdown();
  }, LONG);

  for (const [name, cases] of Object.entries(SAMPLES)) {
    it(`${name}: compiled handle reproduces verified outputs`, async () => {
      const handle = HANDLES.get(name);
      if (handle === undefined) throw new Error(`no handle for ${name}`);
      for (const c of cases) {
        const result = await runCompiled(handle, c.inputs);
        expect(result.status, `${name} ${c.inputs.join("/")}: ${result.message ?? ""}`).toBe("ok");
        expect(result.exitCode).toBe(0);
        expect(toLines(result.stdout)).toEqual(c.lines);
      }
    }, LONG);
  }

  it("runCobol returns the same stdout as a handle run", async () => {
    const handle = HANDLES.get("payroll");
    if (handle === undefined) throw new Error("no payroll handle");
    const c = SAMPLES["payroll"]?.[0];
    if (c === undefined) throw new Error("no payroll case");
    const viaHandle = await runCompiled(handle, c.inputs);
    const single = await runCobol({ source: loadSource("payroll"), inputLines: c.inputs });
    expect(single.status).toBe("ok");
    expect(single.stdout).toBe(viaHandle.stdout);
  }, LONG);

  it("an infinite loop returns timeout", async () => {
    const source = [
      "IDENTIFICATION DIVISION.",
      "PROGRAM-ID. LOOPER.",
      "PROCEDURE DIVISION.",
      "    PERFORM UNTIL 1 = 2",
      "        CONTINUE",
      "    END-PERFORM.",
      "    STOP RUN.",
      "",
    ].join("\n");
    const result = await runCobol({ source, inputLines: [], runTimeoutMs: 1000 });
    expect(result.status).toBe("timeout");
  }, LONG);

  it("a syntax error returns compile_error", async () => {
    const source = [
      "IDENTIFICATION DIVISION.",
      "PROGRAM-ID. BROKEN.",
      "PROCEDURE DIVISION.",
      "    THIS IS NOT COBOL AT ALL.",
      "    STOP RUN.",
      "",
    ].join("\n");
    const result = await runCobol({ source, inputLines: [] });
    expect(result.status).toBe("compile_error");
    expect(result.stderr.length).toBeGreaterThan(0);
  }, LONG);
});
