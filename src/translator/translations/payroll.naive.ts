// DELIBERATELY WRONG: the typical first attempt, floating point and no COBOL field semantics.
// Translates cobol-samples/payroll.cbl. Variant: naive.
import type { Candidate } from "../../equivalence/compare.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const hours = Number.parseFloat(lines[0] ?? "") || 0;
  const rate = Number.parseFloat(lines[1] ?? "") || 0;
  const regular = Math.min(hours, 40); // CURSE:payroll-overtime
  const overtime = Math.max(hours - 40, 0); // CURSE:payroll-overtime
  const gross = regular * rate + overtime * rate * 1.5; // CURSE:payroll-compute-rounding
  const deduct = Math.round(gross * 0.0765 * 100) / 100; // CURSE:payroll-deduct-truncated
  const net = gross - deduct;
  return (
    `GROSS: ${gross.toFixed(2).padStart(9)}\n` + // CURSE:payroll-z-format
    `DEDUCT: ${deduct.toFixed(2).padStart(9)}\n` + // CURSE:payroll-z-format
    `NET: ${net.toFixed(2).padStart(9)}\n` // CURSE:payroll-z-format
  );
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
