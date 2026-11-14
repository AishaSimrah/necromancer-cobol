// COBOL runtime primitives for faithful translations (fixed-point decimals, no floats).
// Plain TypeScript: no Node imports, no framework imports.
import { Decimal as DecimalBase } from "decimal.js";

// Isolated clone: other code changing the global Decimal config cannot affect these values.
const D = DecimalBase.clone({ precision: 60 });

export type Dec = InstanceType<typeof D>;

const PLAIN_DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/**
 * NUMVAL for plain decimal text only (optional sign, digits, optional decimal point).
 * Input is trimmed first. Text that is not plain decimal returns 0; this is a defined
 * fallback, not a claim to cover every NUMVAL form.
 */
export function numval(text: string): Dec {
  const trimmed = text.trim();
  return PLAIN_DECIMAL.test(trimmed) ? new D(trimmed) : new D(0);
}

/** ROUND_DOWN to `scale` decimals (toward zero), as COBOL does without ROUNDED. */
export function truncTo(value: Dec, scale: number): Dec {
  return value.toDecimalPlaces(scale, D.ROUND_DOWN);
}

/** ROUND_HALF_UP to `scale` decimals (half away from zero), as COBOL ROUNDED. */
export function roundTo(value: Dec, scale: number): Dec {
  return value.toDecimalPlaces(scale, D.ROUND_HALF_UP);
}

/** Silent overflow: absolute value, then drop high-order digits (mod 10^digits). */
export function wrap(value: Dec, digits: number): Dec {
  return value.abs().mod(new D(10).pow(digits));
}

/** Store into an unsigned PIC 9(digits)V9(scale) field: truncate, abs, drop high-order digits. */
export function storeUnsigned(value: Dec, digits: number, scale: number): Dec {
  return wrap(truncTo(value, scale), digits);
}

/**
 * Z-edit (e.g. PIC Z(6)9.99): leading zeros become spaces, the last integer
 * position is always a digit, and `scale` decimals are always shown.
 */
export function zEdit(value: Dec, integerPositions: number, scale: number): string {
  const fixed = value.toFixed(scale, D.ROUND_DOWN);
  const [intPart = "0", fracPart] = fixed.split(".");
  const padded = intPart.padStart(integerPositions, " ");
  return fracPart === undefined ? padded : `${padded}.${fracPart}`;
}

/** One DISPLAY line: prefix, edited value, newline. */
export function display(prefix: string, edited: string): string {
  return `${prefix}${edited}\n`;
}
