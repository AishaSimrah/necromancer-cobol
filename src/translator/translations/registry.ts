// Static registry of translation modules. Typed as a complete Record, so a missing
// translation for any sample/variant is a compile error.
import type { SampleId, TranslationModule, Variant } from "../types.js";
import * as interestCorrect from "./interest.correct.js";
import * as interestNaive from "./interest.naive.js";
import * as interestSubtle from "./interest.subtle.js";
import * as payrollCorrect from "./payroll.correct.js";
import * as payrollNaive from "./payroll.naive.js";
import * as payrollSubtle from "./payroll.subtle.js";
import * as taxCorrect from "./tax.correct.js";
import * as taxNaive from "./tax.naive.js";
import * as taxSubtle from "./tax.subtle.js";

export const REGISTRY: Readonly<Record<SampleId, Readonly<Record<Variant, TranslationModule>>>> = {
  tax: { correct: taxCorrect, naive: taxNaive, subtle: taxSubtle },
  interest: { correct: interestCorrect, naive: interestNaive, subtle: interestSubtle },
  payroll: { correct: payrollCorrect, naive: payrollNaive, subtle: payrollSubtle },
};
