import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { GROUP_ORDER } from "../../src/equivalence/classify.js";
import type { EquivalenceReport, Outcome, ProgressEvent } from "../../src/equivalence/report.js";
import { FIXED_MESSAGES, ORACLE_FAILED_DURING_RUN_MESSAGE } from "../../src/server/errors.js";
import { toEngineErrorWire, toProgressWire, toReportWire } from "../../src/server/mappers.js";
import type { ReportEcho } from "../../src/server/mappers.js";

const PROGRESS_KEYS = ["type", "completed", "target", "group", "matched", "mismatches", "inconclusive"];
const REPORT_KEYS = [
  "type",
  "sampleId",
  "variant",
  "caseCount",
  "matchScore",
  "complete",
  "casesRun",
  "conclusiveCount",
  "matchedCount",
  "mismatchCount",
  "groups",
  "mismatches",
  "mismatchListTruncated",
  "shrunkExamples",
  "inconclusiveCount",
  "inconclusiveByStatus",
  "seed",
  "elapsedMs",
  "aborted",
  "budgetReached",
];
const ORACLE_MARKER = "ORACLE-SECRET-MESSAGE-7f3a";

const nat = fc.nat({ max: 1_000_000 });
const group = fc.constantFrom(...GROUP_ORDER);
const leaky = fc.constantFrom(
  "/home/app/src/oracle/worker/main.ts",
  "C:\\Users\\dev\\project\\cobc.exe",
  "Error: boom\n    at run (/app/dist/server/main.js:10:5)",
);
const text = fc.oneof(fc.string({ maxLength: 20 }), leaky);
const inputList = fc.array(text, { maxLength: 4 });
const extras = fc.dictionary(
  fc.constantFrom("matchScore", "score", "Score", "stack", "path", "extra"),
  fc.oneof(fc.double({ noNaN: true }), text),
);

function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

const progressArb: fc.Arbitrary<ProgressEvent> = fc
  .record({
    completed: nat,
    target: nat,
    group,
    matched: nat,
    mismatches: nat,
    inconclusive: nat,
  })
  .chain((base) => extras.map((x) => ({ ...x, ...base }) as ProgressEvent));

const mismatchArb = fc.record({
  input: inputList,
  oracleOutput: text,
  candidateOutput: text,
  group,
  stack: leaky,
});
const shrunkArb = fc.record({
  group,
  input: inputList,
  oracleOutput: text,
  candidateOutput: text,
  limitReached: fc.boolean(),
  path: leaky,
});
const groupSummaryArb = fc.record({ group, conclusive: nat, matched: nat, inconclusive: nat, stack: leaky });

const reportArb = (outcome: Outcome, score: fc.Arbitrary<number | undefined>): fc.Arbitrary<EquivalenceReport> =>
  fc
    .record({
      matchScore: score,
      seed: fc.integer(),
      casesRun: nat,
      conclusiveCount: nat,
      matchedCount: nat,
      mismatchCount: nat,
      mismatches: fc.array(mismatchArb, { maxLength: 4 }),
      mismatchListTruncated: fc.boolean(),
      shrunkExamples: fc.array(shrunkArb, { maxLength: 3 }),
      shrinkOracleCalls: fc.constant({ secret: 1 }),
      groups: fc.array(groupSummaryArb, { maxLength: 4 }),
      inconclusiveCases: fc.array(
        fc.record({ input: inputList, group, status: fc.constant("timeout"), message: leaky }),
        { maxLength: 3 },
      ),
      inconclusiveCount: nat,
      inconclusiveByStatus: fc.dictionary(fc.constantFrom("timeout", "crash", "environment_error"), nat),
      containsInconclusive: fc.boolean(),
      elapsedMs: nat,
      budgetReached: fc.boolean(),
      aborted: fc.boolean(),
      oracleStatus: fc.constant("environment_error"),
      oracleMessage: fc.constant(`${ORACLE_MARKER} at /srv/cobc`),
    })
    .chain((base) =>
      extras.map((x) => {
        const merged: Record<string, unknown> = { ...x, ...base, outcome };
        if (base.matchScore === undefined) delete merged["matchScore"];
        return merged as unknown as EquivalenceReport;
      }),
    );

const echoArb: fc.Arbitrary<ReportEcho> = fc.record({
  sampleId: fc.constantFrom("interest", "payroll", "tax"),
  variant: fc.constantFrom("correct", "subtle", "naive"),
  caseCount: fc.integer({ min: 100, max: 2000 }),
});

const completedArb = reportArb("completed", fc.double({ min: 0, max: 1, noNaN: true }));

describe("mappers", () => {
  // Feature: necromancer-server, Property 7: Progress events never carry a score
  it("Property 7: progress mapping gives exactly seven keys and no score key", () => {
    // **Validates: Requirements 8.3**
    fc.assert(
      fc.property(progressArb, (event) => {
        const wire = toProgressWire(event);
        expect(Object.keys(wire).sort()).toEqual([...PROGRESS_KEYS].sort());
        expect(allKeys(wire).filter((k) => k.toLowerCase().includes("score"))).toEqual([]);
        expect(wire.type).toBe("progress");
        expect(wire.completed).toBe(event.completed);
        expect(wire.group).toBe(event.group);
      }),
    );
  });

  // Feature: necromancer-server, Property 8: Report mapping is an allowlist that passes the Engine's score through
  it("Property 8: report mapping is an allowlist that passes the score through", () => {
    // **Validates: Requirements 8.5, 8.6, 8.7, 8.12**
    fc.assert(
      fc.property(completedArb, echoArb, (report, echo) => {
        const wire = toReportWire(report, echo);
        expect(Object.keys(wire).sort()).toEqual([...REPORT_KEYS].sort());
        expect(wire.matchScore).toBe(report.matchScore);
        expect(wire.complete).toBe(!report.aborted && !report.budgetReached);
        expect(wire.sampleId).toBe(echo.sampleId);
        expect(wire.variant).toBe(echo.variant);
        expect(wire.caseCount).toBe(echo.caseCount);
        expect(Object.keys(wire)).not.toContain("inconclusiveCases");
        const keys = allKeys(wire);
        for (const banned of ["inconclusiveCases", "oracleMessage", "oracleStatus", "shrinkOracleCalls", "containsInconclusive", "stack", "path", "extra", "score"]) {
          expect(keys).not.toContain(banned);
        }
        const json = JSON.stringify(wire);
        expect(json).not.toContain(ORACLE_MARKER);
        expect(json).not.toContain("inconclusiveCases");
      }),
    );
  });

  it("report mapping copies lists field by field", () => {
    fc.assert(
      fc.property(completedArb, echoArb, (report, echo) => {
        const wire = toReportWire(report, echo);
        expect(wire.mismatches).toHaveLength(report.mismatches.length);
        for (const m of wire.mismatches) {
          expect(Object.keys(m).sort()).toEqual(["candidateOutput", "group", "input", "oracleOutput"]);
        }
        for (const s of wire.shrunkExamples) {
          expect(Object.keys(s).sort()).toEqual(["candidateOutput", "group", "input", "limitReached", "oracleOutput"]);
        }
        for (const g of wire.groups) {
          expect(Object.keys(g).sort()).toEqual(["conclusive", "group", "inconclusive", "matched"]);
        }
      }),
    );
  });

  // Feature: necromancer-server, Property 9 (mapper part): Only a completed Engine outcome can produce a score, and error events never contain one
  it("Property 9: toReportWire throws unless completed with a score", () => {
    // **Validates: Requirements 8.8, 8.9, 8.10**
    const echo: ReportEcho = { sampleId: "interest", variant: "correct", caseCount: 100 };
    fc.assert(
      fc.property(
        fc.oneof(
          reportArb("inconclusive", fc.constant(undefined)),
          reportArb("inconclusive", fc.double({ min: 0, max: 1, noNaN: true })),
          reportArb("oracle_unavailable", fc.constant(undefined)),
          reportArb("oracle_unavailable", fc.double({ min: 0, max: 1, noNaN: true })),
          reportArb("completed", fc.constant(undefined)),
        ),
        (report) => {
          expect(() => toReportWire(report, echo)).toThrow();
        },
      ),
    );
  });

  it("Property 9: error mapper output has exactly type, code, message and no score or counts", () => {
    // **Validates: Requirements 8.8, 8.9, 8.10**
    fc.assert(
      fc.property(
        fc.oneof(reportArb("inconclusive", fc.constant(undefined)), reportArb("oracle_unavailable", fc.constant(undefined))),
        (report) => {
          const wire = toEngineErrorWire(report);
          expect(Object.keys(wire).sort()).toEqual(["code", "message", "type"]);
          expect(wire.type).toBe("error");
          if (report.outcome === "inconclusive") {
            expect(wire.code).toBe("inconclusive");
            expect(wire.message).toBe(FIXED_MESSAGES.inconclusive);
          } else {
            expect(wire.code).toBe("oracle_unavailable");
            expect(wire.message).toBe(ORACLE_FAILED_DURING_RUN_MESSAGE);
          }
          const json = JSON.stringify(wire);
          expect(json).not.toMatch(/score/i);
          expect(json).not.toContain(ORACLE_MARKER);
          expect(json).not.toMatch(/count/i);
        },
      ),
    );
  });

  it("toEngineErrorWire rejects a completed outcome", () => {
    expect(() => toEngineErrorWire({ outcome: "completed" })).toThrow();
  });
});
