import type { ErrorWire, ProgressWire, ReportWire } from "../../server/wire.js";
import type { ClassifiedLine } from "./classify-line.js";

export type ViewName = "crypt" | "ritual" | "busy" | "verdict" | "error" | "interrupted";

export type ClientDisplayError = {
  readonly source: "client";
  readonly kind: "unreadable" | "unreachable" | "http-status";
  readonly message: string;
  readonly status?: number;
};

export type DisplayError =
  | { readonly source: "server"; readonly code: string; readonly message: string }
  | ClientDisplayError;

export interface ViewState {
  readonly view: ViewName;
  readonly latestProgress: ProgressWire | undefined;
  /** Only ever a complete report. */
  readonly report: ReportWire | undefined;
  readonly incompleteReport: ReportWire | undefined;
  readonly error: DisplayError | undefined;
  readonly busyAttempt: number | undefined;
  readonly interruptCause: "aborted" | "budget" | "stream-ended" | "cancelled" | undefined;
}

export type StreamEvent =
  | Exclude<ClassifiedLine, { readonly kind: "unreadable" }>
  | { readonly kind: "unreadable"; readonly message: string }
  | { readonly kind: "client-failure"; readonly failure: ClientDisplayError }
  | { readonly kind: "stream-ended" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "busy-wait"; readonly attempt: number }
  | { readonly kind: "busy-exhausted"; readonly error: ErrorWire };

export function initialRitualState(): ViewState {
  return {
    view: "ritual",
    latestProgress: undefined,
    report: undefined,
    incompleteReport: undefined,
    error: undefined,
    busyAttempt: undefined,
    interruptCause: undefined,
  };
}

export function isTerminal(state: ViewState): boolean {
  return state.view === "verdict" || state.view === "interrupted" || state.view === "error";
}

function toErrorState(state: ViewState, error: DisplayError): ViewState {
  return {
    ...state,
    view: "error",
    error,
    latestProgress: undefined,
    report: undefined,
    incompleteReport: undefined,
    busyAttempt: undefined,
    interruptCause: undefined,
  };
}

function toInterrupted(
  state: ViewState,
  cause: "aborted" | "budget" | "stream-ended" | "cancelled",
  incompleteReport: ReportWire | undefined,
): ViewState {
  return {
    ...state,
    view: "interrupted",
    report: undefined,
    incompleteReport,
    busyAttempt: undefined,
    interruptCause: cause,
  };
}

function reduceReport(state: ViewState, report: ReportWire): ViewState {
  if (report.complete) {
    return {
      ...state,
      view: "verdict",
      report,
      incompleteReport: undefined,
      error: undefined,
      busyAttempt: undefined,
      interruptCause: undefined,
    };
  }
  return toInterrupted(state, report.aborted ? "aborted" : "budget", report);
}

export function reduceStreamEvent(state: ViewState, event: StreamEvent): ViewState {
  if (isTerminal(state)) return state;
  switch (event.kind) {
    case "progress":
      return { ...state, view: "ritual", busyAttempt: undefined, latestProgress: event.value };
    case "report":
      return reduceReport(state, event.value);
    case "error":
      return toErrorState(state, {
        source: "server",
        code: event.value.code,
        message: event.value.message,
      });
    case "unreadable":
      return toErrorState(state, { source: "client", kind: "unreadable", message: event.message });
    case "client-failure":
      return toErrorState(state, event.failure);
    case "stream-ended":
      return toInterrupted(state, "stream-ended", undefined);
    case "cancelled":
      return toInterrupted(state, "cancelled", undefined);
    case "busy-wait":
      return { ...state, view: "busy", busyAttempt: event.attempt };
    case "busy-exhausted":
      return toErrorState(state, {
        source: "server",
        code: event.error.code,
        message: event.error.message,
      });
  }
}
