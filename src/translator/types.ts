import type { Candidate } from "../equivalence/compare.js";
import type { FieldDescriptor } from "../equivalence/descriptors.js";

export type SampleId = "interest" | "payroll" | "tax";
export type Variant = "correct" | "subtle" | "naive";
export const SAMPLE_IDS: readonly SampleId[] = ["interest", "payroll", "tax"];
export const VARIANTS: readonly Variant[] = ["correct", "subtle", "naive"];

export interface Curse {
  readonly id: string;
  readonly label: string; // <= 32 chars
  readonly lines: readonly number[]; // 1-based COBOL line numbers
}

export interface ExamplePair {
  readonly input: readonly string[]; // one ACCEPT line per field
  readonly output: string; // exact DISPLAY text, trailing newline included
}

export interface Provenance {
  readonly label: "Pre-generated with Kiro";
  readonly generatedWith: "Kiro";
  readonly date: string; // YYYY-MM-DD
}

/** Static sample data, no fs. */
export interface SampleData {
  readonly id: SampleId;
  readonly name: "INTEREST" | "PAYROLL" | "TAX";
  readonly trapLabel: string;
  readonly fields: readonly FieldDescriptor[];
  readonly defaultInput: readonly string[];
  readonly examples: readonly ExamplePair[];
  readonly fidelityPact: readonly string[];
  readonly curses: readonly Curse[];
}

export interface Sample extends SampleData {
  readonly cobolSource: string;
}

export interface CurseMarker {
  readonly curseId: string;
  readonly line: number;
}

/** What each translations/*.ts module exports. */
export interface TranslationModule {
  readonly candidate: Candidate;
  readonly provenance: Provenance;
}

export interface Translation extends TranslationModule {
  readonly sampleId: SampleId;
  readonly variant: Variant;
  readonly source: string; // file text, read from disk
  readonly markers: readonly CurseMarker[];
}
