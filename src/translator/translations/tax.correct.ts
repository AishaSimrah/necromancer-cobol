// Translates cobol-samples/tax.cbl. Variant: correct (faithful to the COBOL).
import { Decimal } from "decimal.js";
import type { Candidate } from "../../equivalence/compare.js";
import { display, numval, roundTo, storeUnsigned, wrap, zEdit } from "../cobol-runtime.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const income = storeUnsigned(numval(lines[0] ?? ""), 8, 0); // CURSE:tax-whole-unit-rounding
  let tax: Decimal;
  // EVALUATE TRUE: the first matching WHEN wins.
  if (income.lte(250000)) { // CURSE:tax-evaluate-first-match
    tax = new Decimal(0);
  } else if (income.lte(500000)) { // CURSE:tax-brackets
    tax = wrap(roundTo(income.minus(250000).times("0.05"), 0), 8); // CURSE:tax-whole-unit-rounding
  } else if (income.lte(1000000)) { // CURSE:tax-brackets
    tax = wrap(roundTo(income.minus(500000).times("0.20").plus(12500), 0), 8); // CURSE:tax-whole-unit-rounding
  } else {
    tax = wrap(roundTo(income.minus(1000000).times("0.30").plus(112500), 0), 8); // CURSE:tax-whole-unit-rounding
  }
  return display("TAX: ", zEdit(tax, 8, 0));
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
