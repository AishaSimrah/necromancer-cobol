import type { ErrorWire, ProgressWire, ReportWire } from "../../server/wire.js";

export type ClassifiedLine =
  | { readonly kind: "progress"; readonly value: ProgressWire }
  | { readonly kind: "report"; readonly value: ReportWire }
  | { readonly kind: "error"; readonly value: ErrorWire }
  | { readonly kind: "unreadable" };

type Rec = Readonly<Record<string, unknown>>;

const UNREADABLE: ClassifiedLine = { kind: "unreadable" };

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function hasNums(o: Rec, keys: readonly string[]): boolean {
  return keys.every((k) => isNum(o[k]));
}

function hasStrs(o: Rec, keys: readonly string[]): boolean {
  return keys.every((k) => isStr(o[k]));
}

function hasBools(o: Rec, keys: readonly string[]): boolean {
  return keys.every((k) => typeof o[k] === "boolean");
}

function hasArrays(o: Rec, keys: readonly string[]): boolean {
  return keys.every((k) => Array.isArray(o[k]));
}

function isProgress(o: Rec): boolean {
  return (
    hasNums(o, ["completed", "target", "matched", "mismatches", "inconclusive"]) &&
    isStr(o["group"])
  );
}

function isError(o: Rec): boolean {
  return hasStrs(o, ["code", "message"]);
}

function isReport(o: Rec): boolean {
  return (
    hasStrs(o, ["sampleId", "variant"]) &&
    hasNums(o, [
      "caseCount",
      "matchScore",
      "casesRun",
      "conclusiveCount",
      "matchedCount",
      "mismatchCount",
      "inconclusiveCount",
      "seed",
      "elapsedMs",
    ]) &&
    hasBools(o, ["complete", "mismatchListTruncated", "aborted", "budgetReached"]) &&
    hasArrays(o, ["groups", "mismatches", "shrunkExamples"]) &&
    isRecord(o["inconclusiveByStatus"])
  );
}

export function classifyLine(rawLine: string): ClassifiedLine {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch {
    return UNREADABLE;
  }
  if (!isRecord(parsed)) return UNREADABLE;
  switch (parsed["type"]) {
    case "progress":
      return isProgress(parsed) ? { kind: "progress", value: parsed as unknown as ProgressWire } : UNREADABLE;
    case "report":
      return isReport(parsed) ? { kind: "report", value: parsed as unknown as ReportWire } : UNREADABLE;
    case "error":
      return isError(parsed) ? { kind: "error", value: parsed as unknown as ErrorWire } : UNREADABLE;
    default:
      return UNREADABLE;
  }
}
