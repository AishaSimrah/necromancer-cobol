// DELIBERATELY WRONG: the typical first attempt, floating point and no COBOL field semantics.
// Translates cobol-samples/interest.cbl. Variant: naive.
import type { Candidate } from "../../equivalence/compare.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const principal = Number.parseFloat(lines[0] ?? "") || 0;
  const rate = Number.parseFloat(lines[1] ?? "") || 0;
  const years = Number.parseInt(lines[2] ?? "", 10) || 0;
  let balance = principal;
  for (let i = 0; i < years; i++) { // CURSE:interest-yearly-rounding
    balance = balance * (1 + rate / 100);
  }
  return `BALANCE: ${balance.toFixed(2).padStart(10)}\n`; // CURSE:interest-overflow
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
