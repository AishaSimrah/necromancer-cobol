import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runEquivalence } from "../../src/equivalence/index.js";
import type { EquivalenceReport } from "../../src/equivalence/index.js";
import {
  compileCobol,
  isCompiledHandle,
  releaseHandle,
  runCompiled,
  shutdown,
} from "../../src/oracle/index.js";
import { getSample, getTranslation } from "../../src/translator/index.js";
import type { SampleId, Variant } from "../../src/translator/index.js";

const ORACLE_TIMEOUT_MS = 10_000;
const SETUP_TIMEOUT_MS = 600_000;

interface UnderTestEntry {
  readonly sample: SampleId;
  readonly variant: Variant;
}

/** Grows slice by slice, in the same task that adds a translation. */
const UNDER_TEST: readonly UnderTestEntry[] = [
  { sample: "interest", variant: "correct" },
  { sample: "interest", variant: "naive" },
  { sample: "interest", variant: "subtle" },
  { sample: "payroll", variant: "correct" },
];

type RunOutcome =
  | { readonly ok: true; readonly report: EquivalenceReport }
  | { readonly ok: false; readonly error: Error };

const outcomes = new Map<string, RunOutcome>();

function keyOf(sample: SampleId, variant: Variant): string {
  return `${sample}/${variant}`;
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** One Standard_Run against the real Oracle. Never throws. */
async function standardRun(sample: SampleId, variant: Variant): Promise<RunOutcome> {
  try {
    const { cobolSource, fields } = getSample(sample);
    const { candidate } = getTranslation(sample, variant);
    const report = await runEquivalence({
      source: cobolSource,
      fields,
      candidate,
      caseCount: 1000,
      seed: 1,
      oracleTimeoutMs: ORACLE_TIMEOUT_MS,
    });
    if (
      report.outcome !== "completed" ||
      report.inconclusiveCount > 0 ||
      report.matchScore === undefined
    ) {
      return {
        ok: false,
        error: new Error(
          `${keyOf(sample, variant)}: Oracle did not give a conclusive run: outcome=${report.outcome} ` +
            `status=${String(report.oracleStatus)} message=${String(report.oracleMessage)} ` +
            `inconclusive=${report.inconclusiveCount}`,
        ),
      };
    }
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: toError(e) };
  }
}

/** Stored report for a variant; throws the recorded error when the run failed. */
function reportOf(sample: SampleId, variant: Variant): EquivalenceReport {
  const outcome = outcomes.get(keyOf(sample, variant));
  if (outcome === undefined) {
    throw new Error(`No Standard_Run recorded for ${keyOf(sample, variant)}`);
  }
  if (!outcome.ok) {
    throw outcome.error;
  }
  return outcome.report;
}

/** Compile every sample under test once; throw a clear error when the Oracle is unavailable. */
async function probeOracle(): Promise<void> {
  const samples = [...new Set(UNDER_TEST.map((entry) => entry.sample))];
  for (const id of samples) {
    const result = await compileCobol(getSample(id).cobolSource);
    if (!isCompiledHandle(result)) {
      throw new Error(`Oracle unavailable for ${id}: ${result.status} ${result.stderr}`);
    }
    await releaseHandle(result);
  }
}

function printScoreTable(): void {
  const lines: string[] = ["sample/variant | matchScore | mismatches | groups (matched/conclusive)"];
  for (const { sample, variant } of UNDER_TEST) {
    const key = keyOf(sample, variant);
    const outcome = outcomes.get(key);
    if (outcome === undefined) {
      lines.push(`${key} | no run recorded`);
    } else if (!outcome.ok) {
      lines.push(`${key} | FAILED: ${outcome.error.message}`);
    } else {
      const r = outcome.report;
      const groups = r.groups.map((g) => `${g.group} ${g.matched}/${g.conclusive}`).join("; ");
      lines.push(`${key} | ${String(r.matchScore)} | ${r.mismatchCount} | ${groups}`);
    }
  }
  console.info(lines.join("\n"));
}

beforeAll(async () => {
  await probeOracle();
  for (const { sample, variant } of UNDER_TEST) {
    outcomes.set(keyOf(sample, variant), await standardRun(sample, variant));
  }
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  printScoreTable();
  await shutdown();
});

describe("sample translations against the real Oracle", () => {
  it("interest/correct matches the Oracle on every case", () => {
    const report = reportOf("interest", "correct");
    expect(report.matchScore).toBe(1);
    expect(report.mismatchCount).toBe(0);
    expect(report.conclusiveCount).toBe(1000);
    expect(report.inconclusiveCount).toBe(0);
  });

  it("interest/naive is caught: score below 1, mismatches in at least two groups", () => {
    const report = reportOf("interest", "naive");
    expect(report.matchScore).toBeLessThan(1);
    const groupsWithMismatch = report.groups.filter((g) => g.conclusive - g.matched >= 1);
    const detail = report.groups.map((g) => `${g.group} ${g.matched}/${g.conclusive}`).join("; ");
    expect(
      groupsWithMismatch.length,
      `groups with mismatches: ${groupsWithMismatch.length} (${detail})`,
    ).toBeGreaterThanOrEqual(2);
  });

  it("interest/subtle is caught: score below 1 with at least one mismatch", () => {
    const report = reportOf("interest", "subtle");
    expect(report.matchScore).toBeLessThan(1);
    expect(report.mismatchCount).toBeGreaterThanOrEqual(1);
  });

  it("interest ordering: naive < subtle < 1", () => {
    const naive = reportOf("interest", "naive").matchScore;
    const subtle = reportOf("interest", "subtle").matchScore;
    const message = `naive=${String(naive)} subtle=${String(subtle)}`;
    expect(naive, message).toBeDefined();
    expect(subtle, message).toBeDefined();
    expect(naive as number, message).toBeLessThan(subtle as number);
    expect(subtle as number, message).toBeLessThan(1);
  });
});

describe("payroll translations against the real Oracle", () => {
  it("payroll/correct matches the Oracle on every case", () => {
    const report = reportOf("payroll", "correct");
    expect(report.matchScore).toBe(1);
    expect(report.mismatchCount).toBe(0);
    expect(report.conclusiveCount).toBe(1000);
    expect(report.inconclusiveCount).toBe(0);
  });
});

describe("example pairs against the real Oracle", () => {
  const ids: readonly SampleId[] = ["interest", "payroll"];
  for (const id of ids) {
    const sample = getSample(id);
    const { candidate } = getTranslation(id, "correct");

    sample.examples.forEach((pair, index) => {
      it(`${id} example ${index + 1} (${pair.input.join(" / ")}) matches Oracle and candidate`, async () => {
        const compiled = await compileCobol(sample.cobolSource);
        if (!isCompiledHandle(compiled)) {
          throw new Error(`Oracle unavailable for ${id}: ${compiled.status} ${compiled.stderr}`);
        }
        try {
          const result = await runCompiled(compiled, pair.input, { runTimeoutMs: ORACLE_TIMEOUT_MS });
          expect(result.status).toBe("ok");
          expect(result.stdout).toBe(pair.output);
          expect(await candidate([...pair.input])).toBe(pair.output);
        } finally {
          await releaseHandle(compiled);
        }
      });
    });
  }
});
