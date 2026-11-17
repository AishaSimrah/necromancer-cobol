// DELIBERATELY WRONG: the typical first attempt, floating point and no COBOL field semantics.
// Translates cobol-samples/tax.cbl. Variant: naive.
import type { Candidate } from "../../equivalence/compare.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const income = Number.parseFloat(lines[0] ?? "") || 0; // CURSE:tax-unsigned-income
  let rate = 0.3;
  if (income <= 250000) rate = 0; // CURSE:tax-evaluate-first-match
  else if (income <= 500000) rate = 0.05; // CURSE:tax-evaluate-first-match
  else if (income <= 1000000) rate = 0.2; // CURSE:tax-evaluate-first-match
  const tax = Math.round(income * rate); // CURSE:tax-brackets
  return `TAX: ${String(tax).padStart(8)}\n`;
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
