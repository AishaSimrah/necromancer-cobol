import fc from "fast-check";
import { classifyVector, type EvidenceGroup } from "./classify.js";
import type { FieldDescriptor } from "./descriptors.js";
import { EquivalenceConfigError } from "./errors.js";
import { fieldMaxUnits, formatScaled, pow10 } from "./scaled.js";

export interface GeneratedCase {
  readonly index: number;
  readonly lines: readonly string[];
  /** Evidence group of the vector, always `classifyVector` of its lines. */
  readonly group: EvidenceGroup;
  /** Group the vector was constructed for. Absent for edge-corpus vectors. */
  readonly target?: EvidenceGroup;
}

/** A field value: `units` in units of 10^-decimals. Rendered with formatScaled. */
interface Value {
  readonly units: bigint;
  readonly decimals: number;
}

type Target = "std" | "bnd" | "half" | "ovf";
type OverflowKind = "aboveMax" | "extraIntegerDigits" | "negativeUnsigned";

/** Repeating 10-slot cycle: standard 30%, boundaries 30%, half-unit 20%, overflow 20%. */
const SLOT_CYCLE: readonly Target[] = [
  "std", "bnd", "half", "ovf", "std", "bnd", "half", "ovf", "std", "bnd",
];
const OVERFLOW_KINDS: readonly OverflowKind[] = ["aboveMax", "extraIntegerDigits", "negativeUnsigned"];
const TARGETS: readonly Target[] = ["std", "bnd", "half", "ovf"];
const TARGET_GROUP: Readonly<Record<Target, EvidenceGroup>> = {
  std: "standard computation",
  bnd: "zero and maximum boundaries",
  half: "half-unit rounding boundary",
  ovf: "field overflow behavior",
};

/** Edge corpus kinds, in order. Constant size regardless of field count. */
const CORPUS_KINDS = [
  "zero",
  "max",
  "maxMinusUnit",
  "maxPlusUnit",
  "half",
  "extraDecimals",
  "negative",
  "positive",
] as const;
type CorpusKind = (typeof CORPUS_KINDS)[number];
const NEGATIVE_CORPUS_INDEX = CORPUS_KINDS.indexOf("negative");
const CORPUS_STREAM = 4; // seed stream for corpus fallbacks, after the four groups

/** Random material for one field; each generator picks what it needs. */
interface Column {
  readonly stdUnits: bigint; // [1, max - 1]
  readonly stdExtra: number; // 0..3 extra decimals
  readonly stdTail: bigint; // 0..999
  readonly stdNegative: boolean; // used only by signed fields
  readonly halfBase: bigint; // [0, max - 1]
  readonly extraK: number; // 1..3
  readonly extraTail: bigint; // 0..999
  readonly above: bigint; // [0, 9 * max + 8]
  readonly extraInt: bigint; // [0, 99 * 10^(digits+scale) - 1]
  readonly neg: bigint; // [1, max]
}

interface Sample {
  readonly pick: number;
  readonly flag: boolean;
  readonly cols: Column[];
}

/** Stream seed derived from the run seed, kept in int32 range. */
function derive(seed: number, stream: number): number {
  return (seed + Math.imul(stream + 1, 7919)) | 0;
}

function columnArb(f: FieldDescriptor): fc.Arbitrary<Column> {
  const max = fieldMaxUnits(f);
  return fc.record({
    stdUnits: fc.bigInt({ min: 1n, max: max - 1n }),
    stdExtra: fc.integer({ min: 0, max: 3 }),
    stdTail: fc.bigInt({ min: 0n, max: 999n }),
    stdNegative: fc.integer({ min: 0, max: 9 }).map((n) => n < 3),
    halfBase: fc.bigInt({ min: 0n, max: max - 1n }),
    extraK: fc.integer({ min: 1, max: 3 }),
    extraTail: fc.bigInt({ min: 0n, max: 999n }),
    above: fc.bigInt({ min: 0n, max: 9n * max + 8n }),
    extraInt: fc.bigInt({ min: 0n, max: 99n * pow10(f.digits + f.scale) - 1n }),
    neg: fc.bigInt({ min: 1n, max }),
  });
}

function sampleArb(fields: readonly FieldDescriptor[]): fc.Arbitrary<Sample> {
  return fc.record({
    pick: fc.nat(1_000_000),
    flag: fc.boolean(),
    cols: fc.tuple(...fields.map(columnArb)),
  });
}

function drawSamples(fields: readonly FieldDescriptor[], count: number, seed: number): Sample[] {
  if (count <= 0) return [];
  return fc.sample(sampleArb(fields), { seed, numRuns: count });
}

function negate(v: Value, negative: boolean): Value {
  return negative && v.units !== 0n ? { units: -v.units, decimals: v.decimals } : v;
}

/**
 * In-range ordinary value. Extra decimals (0..3) never form the half-unit
 * pattern (5 followed by zeros). Unsigned fields are never negative.
 */
function standardValue(f: FieldDescriptor, c: Column, allowNegative: boolean): Value {
  const k = c.stdExtra;
  let tail = k === 0 ? 0n : c.stdTail % pow10(k);
  if (k > 0 && tail === 5n * pow10(k - 1)) tail += 1n;
  const v: Value = { units: c.stdUnits * pow10(k) + tail, decimals: f.scale + k };
  return negate(v, allowNegative && f.signed && c.stdNegative);
}

function halfValue(f: FieldDescriptor, c: Column, allowNegative: boolean): Value {
  const v: Value = { units: c.halfBase * 10n + 5n, decimals: f.scale + 1 };
  return negate(v, allowNegative && f.signed && c.stdNegative);
}

function overflowValue(f: FieldDescriptor, c: Column, kind: OverflowKind): Value {
  const max = fieldMaxUnits(f);
  switch (kind) {
    case "aboveMax":
      return negate({ units: max + 1n + c.above, decimals: f.scale }, f.signed && c.stdNegative);
    case "extraIntegerDigits":
      return negate(
        { units: pow10(f.digits + f.scale) + c.extraInt, decimals: f.scale },
        f.signed && c.stdNegative,
      );
    case "negativeUnsigned":
      return { units: -c.neg, decimals: f.scale };
  }
}

function corpusValue(f: FieldDescriptor, c: Column, kind: CorpusKind): Value {
  const max = fieldMaxUnits(f);
  switch (kind) {
    case "zero":
      return { units: 0n, decimals: f.scale };
    case "max":
      return { units: max, decimals: f.scale };
    case "maxMinusUnit":
      return { units: max - 1n, decimals: f.scale };
    case "maxPlusUnit":
      return { units: max + 1n, decimals: f.scale };
    case "half":
      return halfValue(f, c, false);
    case "extraDecimals":
      return {
        units: c.halfBase * pow10(c.extraK) + (c.extraTail % pow10(c.extraK)),
        decimals: f.scale + c.extraK,
      };
    case "negative":
      return { units: -c.neg, decimals: f.scale };
    case "positive":
      return standardValue(f, c, false);
  }
}

function render(values: readonly Value[]): string[] {
  return values.map((v) => formatScaled(v.units, v.decimals));
}

function validate(fields: readonly FieldDescriptor[]): void {
  if (fields.length === 0) {
    throw new EquivalenceConfigError("fields: the descriptor list must not be empty");
  }
  for (const f of fields) {
    if (!Number.isInteger(f.digits) || f.digits <= 0) {
      throw new EquivalenceConfigError(`field "${f.name}" digits: must be a positive integer`);
    }
    if (!Number.isInteger(f.scale) || f.scale < 0) {
      throw new EquivalenceConfigError(`field "${f.name}" scale: must be a non-negative integer`);
    }
  }
}

/**
 * Deterministic in (fields, caseCount, seed). Layout: an 8-vector edge corpus
 * (truncated to caseCount), then random slots following SLOT_CYCLE. Each group
 * draws its vectors with fc.sample from its own derived seed.
 */
export function generateCases(
  fields: readonly FieldDescriptor[],
  caseCount: number,
  seed: number,
): GeneratedCase[] {
  validate(fields);
  const corpusSize = Math.min(CORPUS_KINDS.length, caseCount);
  const randomSlots = Math.max(0, caseCount - corpusSize);
  const hasUnsigned = fields.some((f) => !f.signed);

  // Plan the random slots: target group plus overflow kind.
  let negativeBudget =
    Math.max(1, Math.floor(0.1 * caseCount)) - (corpusSize > NEGATIVE_CORPUS_INDEX && hasUnsigned ? 1 : 0);
  let overflowOrdinal = 0;
  const plan: { target: Target; kind: OverflowKind }[] = [];
  for (let r = 0; r < randomSlots; r++) {
    const target = SLOT_CYCLE[r % SLOT_CYCLE.length] ?? "std";
    let kind: OverflowKind = "aboveMax";
    if (target === "ovf") {
      kind = OVERFLOW_KINDS[overflowOrdinal % OVERFLOW_KINDS.length] ?? "aboveMax";
      overflowOrdinal++;
      if (kind === "negativeUnsigned") {
        if (hasUnsigned && negativeBudget > 0) negativeBudget--;
        else kind = "aboveMax";
      }
    }
    plan.push({ target, kind });
  }

  const slotCount = (t: Target): number => plan.filter((p) => p.target === t).length;
  const pools = new Map<Target, Sample[]>(
    TARGETS.map((t, g) => [t, drawSamples(fields, slotCount(t), derive(seed, g))]),
  );
  const corpusSamples = drawSamples(fields, corpusSize, derive(seed, CORPUS_STREAM));
  const used = new Map<Target, number>();

  const cases: GeneratedCase[] = [];
  const push = (values: readonly Value[], target?: EvidenceGroup): void => {
    const lines = render(values);
    const group = classifyVector(fields, lines);
    cases.push(
      target === undefined
        ? { index: cases.length, lines, group }
        : { index: cases.length, lines, group, target },
    );
  };

  for (let k = 0; k < corpusSize; k++) {
    const s = corpusSamples[k];
    const kind = CORPUS_KINDS[k];
    if (s === undefined || kind === undefined) continue;
    push(fields.map((f, i) => corpusValue(f, s.cols[i] as Column, kind)));
  }

  for (const slot of plan) {
    const n = used.get(slot.target) ?? 0;
    used.set(slot.target, n + 1);
    const s = pools.get(slot.target)?.[n];
    if (s === undefined) continue;
    const values = fields.map((f, i) => standardValue(f, s.cols[i] as Column, true));
    if (slot.target === "bnd") {
      const p = s.pick % fields.length;
      const f = fields[p] as FieldDescriptor;
      values[p] = { units: s.flag ? fieldMaxUnits(f) : 0n, decimals: f.scale };
    } else if (slot.target === "half") {
      const p = s.pick % fields.length;
      values[p] = halfValue(fields[p] as FieldDescriptor, s.cols[p] as Column, true);
    } else if (slot.target === "ovf") {
      const candidates = fields.flatMap((f, i) =>
        slot.kind !== "negativeUnsigned" || !f.signed ? [i] : [],
      );
      const p = candidates[s.pick % candidates.length] as number;
      values[p] = overflowValue(fields[p] as FieldDescriptor, s.cols[p] as Column, slot.kind);
    }
    push(values, TARGET_GROUP[slot.target]);
  }
  return cases;
}
