import { EquivalenceConfigError } from "./errors.js";

/** One COBOL input field, taken from its PIC clause (e.g. PIC 9(7)V99 -> digits 7, scale 2). */
export interface FieldDescriptor {
  readonly name: string;
  /** Count of integer digits (the n in 9(n)). */
  readonly digits: number;
  /** Count of implied decimal places (digits after V). */
  readonly scale: number;
  readonly signed: boolean;
}

/** cobol-samples/interest.cbl: principal 9(7)V99, rate 9(3)V99, years 99. */
export const INTEREST: readonly FieldDescriptor[] = [
  { name: "principal", digits: 7, scale: 2, signed: false },
  { name: "rate", digits: 3, scale: 2, signed: false },
  { name: "years", digits: 2, scale: 0, signed: false },
];

/** cobol-samples/payroll.cbl: hours 9(3)V9, rate 9(3)V99. */
export const PAYROLL: readonly FieldDescriptor[] = [
  { name: "hours", digits: 3, scale: 1, signed: false },
  { name: "rate", digits: 3, scale: 2, signed: false },
];

/** cobol-samples/tax.cbl: income 9(8). */
export const TAX: readonly FieldDescriptor[] = [
  { name: "income", digits: 8, scale: 0, signed: false },
];

const MAX_FIELDS = 20;
const MAX_NAME_LENGTH = 64;

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/** Throws EquivalenceConfigError naming the field and property (or the list condition) that is invalid. */
export function validateDescriptors(fields: readonly FieldDescriptor[]): void {
  if (fields.length === 0) {
    throw new EquivalenceConfigError("fields: the descriptor list must not be empty (1 to 20 fields)");
  }
  if (fields.length > MAX_FIELDS) {
    throw new EquivalenceConfigError(
      `fields: the descriptor list has ${fields.length} fields, more than the maximum of ${MAX_FIELDS}`,
    );
  }
  const seen = new Set<string>();
  for (const [index, field] of fields.entries()) {
    const label = `fields[${index}]`;
    const name: unknown = field.name;
    if (typeof name !== "string" || name.length < 1 || name.length > MAX_NAME_LENGTH) {
      throw new EquivalenceConfigError(`${label}.name: must be a string of 1 to ${MAX_NAME_LENGTH} characters`);
    }
    if (seen.has(name)) {
      throw new EquivalenceConfigError(`${label}.name: duplicate field name "${name}"`);
    }
    seen.add(name);
    if (!isIntInRange(field.digits, 1, 18)) {
      throw new EquivalenceConfigError(`field "${name}" digits: must be an integer from 1 to 18`);
    }
    if (!isIntInRange(field.scale, 0, 18)) {
      throw new EquivalenceConfigError(`field "${name}" scale: must be an integer from 0 to 18`);
    }
  }
}
