// Translates cobol-samples/interest.cbl. Variant: subtle.
// Forgotten trap: interest-years-pic99 (years is kept as a wider field instead of PIC 99, so no mod 100).
import type { Candidate } from "../../equivalence/compare.js";
import { display, numval, roundTo, storeUnsigned, wrap, zEdit } from "../cobol-runtime.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const principal = storeUnsigned(numval(lines[0] ?? ""), 7, 2);
  const rate = storeUnsigned(numval(lines[1] ?? ""), 3, 2);
  const years = storeUnsigned(numval(lines[2] ?? ""), 4, 0).toNumber(); // CURSE:interest-years-pic99  NOT HANDLED: years is not reduced modulo 100 (PIC 99)
  const factor = rate.div(100).plus(1);
  let balance = principal;
  for (let year = 1; year <= years; year++) { // CURSE:interest-yearly-rounding
    balance = wrap(roundTo(balance.times(factor), 2), 7); // CURSE:interest-yearly-rounding // CURSE:interest-overflow
  }
  return display("BALANCE: ", zEdit(balance, 7, 2));
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
