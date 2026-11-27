import type { ErrorWire } from "../../server/wire.js";

export const BUSY_RETRY_INTERVAL_MS = 5000;
export const BUSY_RETRY_MAX = 6;

export interface BusyState {
  readonly phase: "requesting" | "waiting" | "ended";
  /** Retry requests already sent (0..6). */
  readonly retriesDone: number;
  /** 1 initial request plus retries. */
  readonly requestsSent: number;
}

export type BusyEvent =
  | { readonly kind: "busy-response"; readonly error: ErrorWire }
  | { readonly kind: "other-response" }
  | { readonly kind: "timer-fired" }
  | { readonly kind: "cancel" };

export type BusyStep =
  | { readonly kind: "wait"; readonly attempt: number; readonly delayMs: 5000 }
  | { readonly kind: "send"; readonly attempt: number }
  | { readonly kind: "give-up"; readonly error: ErrorWire }
  | { readonly kind: "cancelled" }
  | { readonly kind: "finished" }
  | { readonly kind: "none" };

export interface BusyTransition {
  readonly state: BusyState;
  readonly step: BusyStep;
}

const NONE: BusyStep = { kind: "none" };

export function initialBusyState(): BusyState {
  return { phase: "requesting", retriesDone: 0, requestsSent: 1 };
}

export function nextBusyStep(state: BusyState, event: BusyEvent): BusyTransition {
  switch (event.kind) {
    case "busy-response":
      if (state.phase !== "requesting") return { state, step: NONE };
      if (state.retriesDone < BUSY_RETRY_MAX) {
        return {
          state: { ...state, phase: "waiting" },
          step: { kind: "wait", attempt: state.retriesDone + 1, delayMs: BUSY_RETRY_INTERVAL_MS },
        };
      }
      return { state: { ...state, phase: "ended" }, step: { kind: "give-up", error: event.error } };
    case "other-response":
      if (state.phase !== "requesting") return { state, step: NONE };
      return { state: { ...state, phase: "ended" }, step: { kind: "finished" } };
    case "timer-fired": {
      if (state.phase !== "waiting") return { state, step: NONE };
      const retriesDone = state.retriesDone + 1;
      return {
        state: { phase: "requesting", retriesDone, requestsSent: state.requestsSent + 1 },
        step: { kind: "send", attempt: retriesDone },
      };
    }
    case "cancel":
      if (state.phase === "ended") return { state, step: NONE };
      return { state: { ...state, phase: "ended" }, step: { kind: "cancelled" } };
  }
}
