import type { FieldDescriptor } from "./descriptors.js";

/** 10^n as a bigint. */
export function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

/** Largest magnitude of a field in units of 10^-scale: 10^(digits+scale) - 1. */
export function fieldMaxUnits(f: FieldDescriptor): bigint {
  return pow10(f.digits + f.scale) - 1n;
}

/**
 * Render units / 10^decimals as plain decimal text: optional "-", digits and,
 * when decimals > 0, a point with exactly `decimals` digits. Never "-0", never
 * an exponent.
 */
export function formatScaled(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const p = pow10(decimals);
  const intPart = (abs / p).toString();
  const body =
    decimals === 0 ? intPart : `${intPart}.${(abs % p).toString().padStart(decimals, "0")}`;
  return negative && abs !== 0n ? `-${body}` : body;
}

const PLAIN_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Inverse of formatScaled for plain decimal text. Returns null when the text is
 * not plain decimal or has more than `decimals` fractional digits.
 */
export function parseScaled(text: string, decimals: number): bigint | null {
  const m = PLAIN_DECIMAL.exec(text);
  if (m === null) return null;
  const sign = m[1] ?? "";
  const intDigits = m[2] ?? "";
  const frac = m[3] ?? "";
  if (frac.length > decimals) return null;
  const units = BigInt(intDigits + frac.padEnd(decimals, "0"));
  return sign === "-" ? -units : units;
}
