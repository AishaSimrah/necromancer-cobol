import { INTEREST, PAYROLL, TAX } from "../equivalence/descriptors.js";
import type { FieldDescriptor } from "../equivalence/descriptors.js";
import type { SampleData, SampleId } from "./types.js";

/**
 * Recursively freezes an object graph in place and returns it.
 * Already-frozen values are skipped, so shared references are safe.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

/** Copies each descriptor object so the catalog never shares (or freezes) the originals. */
function copyFields(fields: readonly FieldDescriptor[]): readonly FieldDescriptor[] {
  return fields.map((field) => ({ ...field }));
}

const INTEREST_DATA: SampleData = {
  id: "interest",
  name: "INTEREST",
  trapLabel: "per-year rounding and silent overflow",
  fields: copyFields(INTEREST),
  defaultInput: ["1000", "5", "3"],
  examples: [
    { input: ["1000", "5", "3"], output: "BALANCE:    1157.63\n" },
    { input: ["1234.56", "7.25", "10"], output: "BALANCE:    2485.95\n" },
    { input: ["9000000", "50", "3"], output: "BALANCE: 7875000.00\n" },
  ],
  fidelityPact: [
    "Rounds half away from zero at every year, not once at the end",
    "Drops high-order digits when the balance passes 9,999,999.99",
    "Reads years as PIC 99 and stores negatives as absolute values",
    "Prints BALANCE exactly as Z(6)9.99 with a trailing newline",
  ],
  curses: [
    { id: "interest-yearly-rounding", label: "per-year rounding", lines: [29, 30, 31] },
    { id: "interest-overflow", label: "silent field overflow", lines: [17, 30] },
    { id: "interest-years-pic99", label: "PIC 99 years", lines: [16, 27] },
  ],
};

const PAYROLL_DATA: SampleData = {
  id: "payroll",
  name: "PAYROLL",
  trapLabel: "overtime and truncated deduction",
  fields: copyFields(PAYROLL),
  defaultInput: ["45", "20.55"],
  examples: [
    {
      input: ["45", "20.55"],
      output: "GROSS:    976.13\nDEDUCT:     74.67\nNET:    901.46\n",
    },
    {
      input: ["32.5", "18.99"],
      output: "GROSS:    617.18\nDEDUCT:     47.21\nNET:    569.97\n",
    },
  ],
  fidelityPact: [
    "Pays hours over 40 at 1.5x",
    "Rounds regular and overtime pay to cents at each COMPUTE",
    "Truncates the 7.65% deduction instead of rounding it",
    "Prints GROSS, DEDUCT and NET as Z(5)9.99, one per line",
  ],
  curses: [
    { id: "payroll-overtime", label: "overtime over 40 at 1.5x", lines: [29, 30, 31, 37] },
    { id: "payroll-compute-rounding", label: "per-COMPUTE rounding", lines: [36, 37] },
    {
      id: "payroll-deduct-truncated",
      label: "deduction truncated, not rounded",
      lines: [39],
    },
    {
      id: "payroll-z-format",
      label: "Z(5)9.99 output format",
      lines: [22, 41, 42, 43, 44, 45, 46],
    },
    { id: "payroll-hours-pic", label: "hours field PIC 9(3)V9", lines: [13, 27] },
  ],
};

const TAX_DATA: SampleData = {
  id: "tax",
  name: "TAX",
  trapLabel: "progressive brackets",
  fields: copyFields(TAX),
  defaultInput: ["300000"],
  examples: [
    { input: ["300000"], output: "TAX:     2500\n" },
    { input: ["750000"], output: "TAX:    62500\n" },
    { input: ["2000000"], output: "TAX:   412500\n" },
  ],
  fidelityPact: [
    "Taxes only the slice of income inside each bracket",
    "Takes the first matching EVALUATE branch only",
    "Rounds tax half away from zero to whole units",
    "Prints TAX as Z(7)9 with a trailing newline",
  ],
  curses: [
    { id: "tax-brackets", label: "progressive brackets", lines: [20, 22, 23, 24, 25, 26, 27] },
    { id: "tax-evaluate-first-match", label: "EVALUATE first match", lines: [19, 20, 22, 24, 26, 28] },
    { id: "tax-whole-unit-rounding", label: "whole-unit rounding", lines: [13, 23, 25, 27] },
  ],
};

/**
 * Static data for the three samples, deeply frozen.
 * `fields` are copies of the descriptor arrays in src/equivalence/descriptors.ts, so deepFreeze
 * freezes only the copies and importing this module never changes INTEREST, PAYROLL or TAX.
 */
export const SAMPLE_DATA: Readonly<Record<SampleId, SampleData>> = deepFreeze({
  interest: INTEREST_DATA,
  payroll: PAYROLL_DATA,
  tax: TAX_DATA,
});
