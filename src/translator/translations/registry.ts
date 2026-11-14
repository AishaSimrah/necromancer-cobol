// Static registry of translation modules, keyed "<sampleId>/<variant>".
// Partial for now; task 13.1 tightens it to a complete Record<SampleId, Record<Variant, ...>>.
import type { SampleId, TranslationModule, Variant } from "../types.js";
import * as interestCorrect from "./interest.correct.js";
import * as interestNaive from "./interest.naive.js";
import * as interestSubtle from "./interest.subtle.js";
import * as payrollCorrect from "./payroll.correct.js";
import * as payrollNaive from "./payroll.naive.js";
import * as payrollSubtle from "./payroll.subtle.js";

const REGISTRY: Readonly<Partial<Record<`${SampleId}/${Variant}`, TranslationModule>>> = {
  "interest/correct": interestCorrect,
  "interest/naive": interestNaive,
  "interest/subtle": interestSubtle,
  "payroll/correct": payrollCorrect,
  "payroll/naive": payrollNaive,
  "payroll/subtle": payrollSubtle,
};

export function getTranslationModule(sampleId: SampleId, variant: Variant): TranslationModule {
  const key = `${sampleId}/${variant}` as const;
  const found = REGISTRY[key];
  if (found === undefined) {
    throw new Error(`No translation registered for ${sampleId}/${variant}`);
  }
  return found;
}
