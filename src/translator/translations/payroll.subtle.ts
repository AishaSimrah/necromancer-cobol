// Translates cobol-samples/payroll.cbl. Variant: subtle.
// Forgotten trap: payroll-hours-pic (hours is kept in a wider field than PIC 9(3)V9, so no mod 1000).
import { Decimal } from "decimal.js";
import type { Candidate } from "../../equivalence/compare.js";
import { display, numval, roundTo, storeUnsigned, truncTo, wrap, zEdit } from "../cobol-runtime.js";
import type { Provenance } from "../types.js";

export const candidate: Candidate = (lines) => {
  const hours = storeUnsigned(numval(lines[0] ?? ""), 4, 1); // CURSE:payroll-hours-pic  NOT HANDLED: hours is stored in a field one digit too wide (9(4)V9 instead of 9(3)V9), so values of 1000 or more are not wrapped
  const rate = storeUnsigned(numval(lines[1] ?? ""), 3, 2);
  const overtime = hours.gt(40); // CURSE:payroll-overtime
  const regHours = overtime ? new Decimal(40) : hours;
  const otHours = overtime ? truncTo(hours.minus(40), 1) : new Decimal(0); // CURSE:payroll-overtime
  const regPay = wrap(roundTo(regHours.times(rate), 2), 6); // CURSE:payroll-compute-rounding
  const otPay = wrap(roundTo(otHours.times(rate).times("1.5"), 2), 6); // CURSE:payroll-compute-rounding // CURSE:payroll-overtime
  const gross = wrap(truncTo(regPay.plus(otPay), 2), 6);
  const deduct = wrap(truncTo(gross.times("0.0765"), 2), 6); // CURSE:payroll-deduct-truncated
  const net = wrap(truncTo(gross.minus(deduct), 2), 6); // unsigned: abs() inside wrap
  return (
    display("GROSS: ", zEdit(gross, 6, 2)) + // CURSE:payroll-z-format
    display("DEDUCT: ", zEdit(deduct, 6, 2)) + // CURSE:payroll-z-format
    display("NET: ", zEdit(net, 6, 2)) // CURSE:payroll-z-format
  );
};

export const provenance: Provenance = {
  label: "Pre-generated with Kiro",
  generatedWith: "Kiro",
  date: "2026-11-12",
};
