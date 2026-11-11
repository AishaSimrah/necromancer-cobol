import { Decimal as DecimalBase } from "decimal.js";

/** Isolated Decimal with enough precision that rate / 100 and the product stay exact. */
const D = DecimalBase.clone({ precision: 60 });
type Dec = InstanceType<typeof D>;

/** COBOL FUNCTION NUMVAL for plain decimal text; unparseable text yields 0. */
function numval(text: string): Dec {
  try {
    return new D(text.trim());
  } catch {
    return new D(0);
  }
}

/** Store into an unsigned PIC 9(digits)V9(scale): truncate toward zero, drop sign, wrap high-order digits. */
function store(value: Dec, digits: number, scale: number): Dec {
  return value.toDecimalPlaces(scale, DecimalBase.ROUND_DOWN).abs().mod(new D(10).pow(digits));
}

/** PIC Z(6)9.99 for a value below 10^7. */
function formatZ(value: Dec): string {
  const [intPart = "0", fracPart = "00"] = value.toFixed(2).split(".");
  return `${intPart.padStart(7, " ")}.${fracPart}`;
}

/** Faithful TypeScript equivalent of cobol-samples/interest.cbl. */
export function correctInterestCandidate(lines: string[]): string {
  const principal = store(numval(lines[0] ?? ""), 7, 2);
  const rate = store(numval(lines[1] ?? ""), 3, 2);
  const years = store(numval(lines[2] ?? ""), 2, 0).toNumber();
  const factor = new D(1).plus(rate.div(100));
  let balance = principal;
  for (let i = 0; i < years; i++) {
    balance = balance
      .times(factor)
      .toDecimalPlaces(2, DecimalBase.ROUND_HALF_UP)
      .mod(new D(10).pow(7));
  }
  return `BALANCE: ${formatZ(balance)}\n`;
}

/**
 * Deliberately wrong translation: floating point, no per-year rounding, no input
 * truncation, no wrap. The only Candidate allowed to use floating point.
 */
export function naiveInterestCandidate(lines: string[]): string {
  const principal = Number.parseFloat(lines[0] ?? "") || 0;
  const rate = Number.parseFloat(lines[1] ?? "") || 0;
  const years = Number.parseInt(lines[2] ?? "", 10) || 0;
  let balance = principal;
  for (let i = 0; i < years; i++) {
    balance = balance * (1 + rate / 100);
  }
  return `BALANCE: ${balance.toFixed(2).padStart(10)}\n`;
}
