// Feature: necromancer-frontend, Property 3: The reducer exposes a report only if the first terminal event is a Complete_Report
// **Validates: Requirements 4.3, 4.4, 4.8, 4.10, 6.1, 6.2, 6.12, 7.14, 7.16, 12.4**
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { ErrorWire, ProgressWire, ReportWire } from "../../src/server/wire.js";
import {
  initialRitualState,
  reduceStreamEvent,
  type StreamEvent,
  type ViewState,
} from "../../src/frontend/core/view-state.js";

const progressArb: fc.Arbitrary<ProgressWire> = fc.record({
  type: fc.constant("progress" as const),
  completed: fc.nat(10000),
  target: fc.nat(10000),
  group: fc.string({ maxLength: 12 }),
  matched: fc.nat(10000),
  mismatches: fc.nat(10000),
  inconclusive: fc.nat(10000),
});

function reportArb(complete: boolean): fc.Arbitrary<ReportWire> {
  return fc.record({
    type: fc.constant("report" as const),
    sampleId: fc.constantFrom("interest" as const, "payroll" as const, "tax" as const),
    variant: fc.constantFrom("correct" as const, "subtle" as const, "naive" as const),
    caseCount: fc.nat(10000),
    matchScore: fc.double({ min: 0, max: 1, noNaN: true }),
    complete: fc.constant(complete),
    casesRun: fc.nat(10000),
    conclusiveCount: fc.nat(10000),
    matchedCount: fc.nat(10000),
    mismatchCount: fc.nat(10000),
    groups: fc.constant([]),
    mismatches: fc.constant([]),
    mismatchListTruncated: fc.boolean(),
    shrunkExamples: fc.constant([]),
    inconclusiveCount: fc.nat(10000),
    inconclusiveByStatus: fc.constant({}),
    seed: fc.nat(1000000),
    elapsedMs: fc.nat(100000),
    aborted: fc.boolean(),
    budgetReached: fc.boolean(),
  });
}

const errorArb: fc.Arbitrary<ErrorWire> = fc.record({
  type: fc.constant("error" as const),
  code: fc.string({ minLength: 1, maxLength: 12 }),
  message: fc.string({ maxLength: 30 }),
});

const eventArb: fc.Arbitrary<StreamEvent> = fc.oneof(
  progressArb.map((value): StreamEvent => ({ kind: "progress", value })),
  reportArb(true).map((value): StreamEvent => ({ kind: "report", value })),
  reportArb(false).map((value): StreamEvent => ({ kind: "report", value })),
  errorArb.map((value): StreamEvent => ({ kind: "error", value })),
  fc.string({ maxLength: 20 }).map((message): StreamEvent => ({ kind: "unreadable", message })),
  fc
    .tuple(
      fc.constantFrom("unreachable" as const, "http-status" as const, "unreadable" as const),
      fc.string({ maxLength: 20 }),
      fc.integer({ min: 100, max: 599 }),
    )
    .map(
      ([kind, message, status]): StreamEvent => ({
        kind: "client-failure",
        failure: { source: "client", kind, message, status },
      }),
    ),
  fc.constant<StreamEvent>({ kind: "stream-ended" }),
  fc.constant<StreamEvent>({ kind: "cancelled" }),
  fc.integer({ min: 1, max: 6 }).map((attempt): StreamEvent => ({ kind: "busy-wait", attempt })),
  errorArb.map((error): StreamEvent => ({ kind: "busy-exhausted", error })),
);

const eventsArb: fc.Arbitrary<StreamEvent[]> = fc.array(eventArb, { maxLength: 30 });

function isTerminalEvent(e: StreamEvent): boolean {
  return !(e.kind === "progress" || e.kind === "busy-wait");
}

function isCompleteReport(e: StreamEvent): boolean {
  return e.kind === "report" && e.value.complete;
}

describe("Property 3: reducer exposes a report only for a first-terminal Complete_Report", () => {
  it("report is defined iff the first terminal event is a complete report", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const final = events.reduce(reduceStreamEvent, initialRitualState());
        const first = events.find(isTerminalEvent);
        expect(final.report !== undefined).toBe(first !== undefined && isCompleteReport(first));
        if (first !== undefined && isCompleteReport(first) && first.kind === "report") {
          expect(final.report).toBe(first.value);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("events after the first terminal event change nothing", () => {
    fc.assert(
      fc.property(eventsArb, eventsArb, (head, tail) => {
        const terminal = head.findIndex(isTerminalEvent);
        const upTo = terminal === -1 ? head : head.slice(0, terminal + 1);
        const settled = upTo.reduce(reduceStreamEvent, initialRitualState());
        if (terminal === -1) return;
        const after = tail.reduce(reduceStreamEvent, settled);
        expect(after).toBe(settled);
        expect(after).toEqual(settled);
      }),
      { numRuns: 300 },
    );
  });

  it("view is ritual or busy only while report is undefined, at every step", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        let state: ViewState = initialRitualState();
        for (const event of events) {
          state = reduceStreamEvent(state, event);
          if (state.view === "ritual" || state.view === "busy") {
            expect(state.report).toBeUndefined();
          }
          if (state.report !== undefined) {
            expect(state.view).toBe("verdict");
            expect(state.report.complete).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("an incomplete report never sets report and lands in interrupted", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(progressArb.map((value): StreamEvent => ({ kind: "progress", value })), fc.integer({ min: 1, max: 6 }).map((attempt): StreamEvent => ({ kind: "busy-wait", attempt }))), { maxLength: 10 }),
        reportArb(false),
        eventsArb,
        (prefix, incomplete, tail) => {
          const events: StreamEvent[] = [...prefix, { kind: "report", value: incomplete }, ...tail];
          const final = events.reduce(reduceStreamEvent, initialRitualState());
          expect(final.report).toBeUndefined();
          expect(final.view).toBe("interrupted");
          expect(final.incompleteReport).toBe(incomplete);
        },
      ),
      { numRuns: 200 },
    );
  });
});
