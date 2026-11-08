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
