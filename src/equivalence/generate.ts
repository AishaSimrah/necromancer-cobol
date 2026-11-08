import fc from "fast-check";
import type { FieldDescriptor } from "./descriptors.js";
import { fieldMaxUnits, formatScaled } from "./scaled.js";

export interface GeneratedCase {
  readonly index: number;
  readonly lines: readonly string[];
}

/** Per-field seed derived from the run seed, kept in int32 range. */
function fieldSeed(seed: number, fieldIndex: number): number {
  return (seed + Math.imul(fieldIndex + 1, 7919)) | 0;
}

/**
 * Minimal deterministic generator: case 0 is all zeros, case 1 is all maxima,
 * the rest are seeded in-range values. One plain-decimal line per field.
 */
export function generateCases(
  fields: readonly FieldDescriptor[],
  caseCount: number,
  seed: number,
): GeneratedCase[] {
  const randomCount = Math.max(0, caseCount - 2);
  const samples: bigint[][] = fields.map((f, i) =>
    randomCount === 0
      ? []
      : fc.sample(fc.bigInt({ min: 0n, max: fieldMaxUnits(f) }), {
          seed: fieldSeed(seed, i),
          numRuns: randomCount,
        }),
  );

  const cases: GeneratedCase[] = [];
  for (let index = 0; index < caseCount; index++) {
    const lines = fields.map((f, i) => {
      const units =
        index === 0 ? 0n : index === 1 ? fieldMaxUnits(f) : (samples[i]?.[index - 2] ?? 0n);
      return formatScaled(units, f.scale);
    });
    cases.push({ index, lines });
  }
  return cases;
}
