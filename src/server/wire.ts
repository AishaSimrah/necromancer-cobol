import type { SampleId, Variant } from "../translator/types.js";

/** Every JSON shape that leaves the server. The only place that defines response keys. */

export interface HealthBody {
  readonly status: "ok" | "degraded";
  readonly oracle: "ready" | "unavailable";
  readonly cobcVersion: string | null;
  readonly uptimeMs: number;
}

export interface SampleSummary {
  readonly id: string;
  readonly name: string;
  readonly trapLabel: string;
  readonly defaultInput: readonly string[];
}

export interface FieldWire {
  readonly name: string;
  readonly digits: number;
  readonly scale: number;
  readonly signed: boolean;
}

export interface CurseWire {
  readonly id: string;
  readonly label: string;
  readonly lines: readonly number[];
}

export interface ExampleWire {
  readonly input: readonly string[];
  readonly output: string;
}

export interface TranslationWire {
  readonly variant: Variant;
  readonly source: string;
  readonly provenance: {
    readonly label: string;
    readonly generatedWith: string;
    readonly date: string;
  };
  readonly markers: readonly { readonly curseId: string; readonly line: number }[];
}

export interface SampleDetail extends SampleSummary {
  readonly cobolSource: string;
  readonly fields: readonly FieldWire[];
  readonly curses: readonly CurseWire[];
  readonly fidelityPact: readonly string[];
  readonly examples: readonly ExampleWire[];
  readonly translations: readonly TranslationWire[];
}

export interface ProveRequest {
  readonly sampleId: SampleId;
  readonly variant: Variant;
  /** Default applied. */
  readonly caseCount: number;
  readonly seed: number | undefined;
}

/** No key of this type contains "score". */
export interface ProgressWire {
  readonly type: "progress";
  readonly completed: number;
  readonly target: number;
  readonly group: string;
  readonly matched: number;
  readonly mismatches: number;
  readonly inconclusive: number;
}

export interface GroupWire {
  readonly group: string;
  readonly conclusive: number;
  readonly matched: number;
  readonly inconclusive: number;
}

export interface MismatchWire {
  readonly input: readonly string[];
  readonly oracleOutput: string;
  readonly candidateOutput: string;
  readonly group: string;
}

export interface ShrunkWire {
  readonly group: string;
  readonly input: readonly string[];
  readonly oracleOutput: string;
  readonly candidateOutput: string;
  readonly limitReached: boolean;
}

export interface ReportWire {
  readonly type: "report";
  readonly sampleId: SampleId;
  readonly variant: Variant;
  readonly caseCount: number;
  readonly matchScore: number;
  readonly complete: boolean;
  readonly casesRun: number;
  readonly conclusiveCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly groups: readonly GroupWire[];
  readonly mismatches: readonly MismatchWire[];
  readonly mismatchListTruncated: boolean;
  readonly shrunkExamples: readonly ShrunkWire[];
  readonly inconclusiveCount: number;
  readonly inconclusiveByStatus: Readonly<Record<string, number>>;
  readonly seed: number;
  readonly elapsedMs: number;
  readonly aborted: boolean;
  readonly budgetReached: boolean;
}

/** Exactly type, code, message. */
export interface ErrorWire {
  readonly type: "error";
  readonly code: string;
  readonly message: string;
}
