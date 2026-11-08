import { Decimal as BaseDecimal } from "decimal.js";
import type { FieldDescriptor } from "./descriptors.js";

/** Exact arithmetic for any input length; the default 20 significant digits could round. */
const Decimal = BaseDecimal.clone({ precision: 200 });

export type EvidenceGroup =
  | "standard computation"
  | "zero and maximum boundaries"
  | "half-unit rounding boundary"
  | "field overflow behavior";

/** Classification precedence: the first qualifying group wins (Req 4.6). */
export const GROUP_ORDER: readonly EvidenceGroup[] = [
  "field overflow behavior",
  "half-unit rounding boundary",
  "zero and maximum boundaries",
  "standard computation",
];

const HALF = new Decimal("0.5");

/** Field_Maximum = 10^digits - 10^(-scale). */
function fieldMaximum(f: FieldDescriptor): BaseDecimal {
  return new Decimal(10).pow(f.digits).minus(new Decimal(10).pow(-f.scale));
}

function isOverflow(f: FieldDescriptor, value: BaseDecimal): boolean {
  // lt(0) is false for -0, so "-0" on an unsigned field is not negative.
  if (!f.signed && value.lt(0)) return true;
  return value.abs().gt(fieldMaximum(f));
}

/** Digits beyond the declared scale are exactly 5 followed only by zeros. */
function isHalfUnit(f: FieldDescriptor, value: BaseDecimal): boolean {
  return value.abs().times(new Decimal(10).pow(f.scale)).mod(1).eq(HALF);
}

function isZeroOrMax(f: FieldDescriptor, value: BaseDecimal): boolean {
  return value.isZero() || value.eq(fieldMaximum(f));
}

/**
 * Assigns a vector to exactly one Evidence_Group. Throws if a line is missing
 * or is not decimal text; the generator only produces plain decimals.
 */
export function classifyVector(
  fields: readonly FieldDescriptor[],
  lines: readonly string[],
): EvidenceGroup {
  if (lines.length !== fields.length) {
    throw new RangeError(`expected ${fields.length} lines, got ${lines.length}`);
  }
  const pairs = fields.map((f, i) => ({ f, v: new Decimal(lines[i] ?? "") }));
  if (pairs.some(({ f, v }) => isOverflow(f, v))) return "field overflow behavior";
  if (pairs.some(({ f, v }) => isHalfUnit(f, v))) return "half-unit rounding boundary";
  if (pairs.some(({ f, v }) => isZeroOrMax(f, v))) return "zero and maximum boundaries";
  return "standard computation";
}
