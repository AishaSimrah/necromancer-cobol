import fc from "fast-check";
import type { EvidenceGroup } from "./classify.js";
import { invokeCandidate, outputsEqual, type Candidate } from "./compare.js";
import type { FieldDescriptor } from "./descriptors.js";
import type { CompiledHandle, OraclePort } from "./oracle-port.js";
import type { MismatchRecord } from "./report.js";
import { formatScaled, parseScaled, pow10 } from "./scaled.js";

/** Extra decimal places used while shrinking so every generated value is exactly representable. */
const EXTRA_DECIMALS = 3;

const OVERFLOW_GROUP: EvidenceGroup = "field overflow behavior";

export interface ShrunkExample {
  readonly group: EvidenceGroup;
  readonly input: readonly string[];
  readonly oracleOutput: string;
  readonly candidateOutput: string;
  /** True only when shrinking stopped because the Oracle call limit was reached. */
  readonly limitReached: boolean;
}

export interface ShrinkContext {
  readonly oracle: OraclePort;
  readonly handle: CompiledHandle;
  readonly candidate: Candidate;
  readonly fields: readonly FieldDescriptor[];
  readonly seed: number;
  readonly limit: number;
  readonly runTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ShrinkResult {
  readonly example: ShrunkExample;
  readonly oracleCalls: number;
}

interface Best {
  input: readonly string[];
  oracleOutput: string;
  candidateOutput: string;
}

/** Read at call time so TypeScript does not narrow `signal.aborted` across awaits. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function fineScale(f: FieldDescriptor): number {
  return f.scale + EXTRA_DECIMALS;
}

/** Domain bounds in units of 10^-(scale+3) for one field, widened to include `startUnits`. */
function fieldArbitrary(
  f: FieldDescriptor,
  group: EvidenceGroup,
  startUnits: bigint,
): fc.Arbitrary<bigint> {
  const overflow = group === OVERFLOW_GROUP;
  const fieldMax = pow10(f.digits + fineScale(f)) - pow10(EXTRA_DECIMALS);
  const bound = overflow ? pow10(f.digits + 2 + fineScale(f)) - 1n : fieldMax;
  const lowest = f.signed || overflow ? -bound : 0n;
  const min = startUnits < lowest ? startUnits : lowest;
  const max = startUnits > bound ? startUnits : bound;
  return fc.bigInt({ min, max });
}

function parseStart(
  fields: readonly FieldDescriptor[],
  lines: readonly string[],
): bigint[] | null {
  if (lines.length !== fields.length) return null;
  const units: bigint[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const line = lines[i];
    if (f === undefined || line === undefined) return null;
    const parsed = parseScaled(line, fineScale(f));
    if (parsed === null) return null;
    units.push(parsed);
  }
  return units;
}

function sameUnits(a: readonly bigint[], b: readonly bigint[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Shrinks the first Mismatch of a group with fast-check, starting from the
 * recorded failing vector (`examples`). The starting example is answered from
 * the record, so it costs no Oracle call. Oracle runtime errors propagate.
 */
export async function shrinkGroup(ctx: ShrinkContext, start: MismatchRecord): Promise<ShrinkResult> {
  const best: Best = {
    input: start.input,
    oracleOutput: start.oracleOutput,
    candidateOutput: start.candidateOutput,
  };
  let oracleCalls = 0;
  let limitReached = false;
  let fatal: { readonly error: unknown } | null = null;

  const finish = (): ShrinkResult => ({
    example: {
      group: start.group,
      input: best.input,
      oracleOutput: best.oracleOutput,
      candidateOutput: best.candidateOutput,
      limitReached,
    },
    oracleCalls,
  });

  const startUnits = parseStart(ctx.fields, start.input);
  if (startUnits === null) return finish();

  const arb = fc.tuple(
    ...ctx.fields.map((f, i) => fieldArbitrary(f, start.group, startUnits[i] ?? 0n)),
  );
  const runOptions =
    ctx.runTimeoutMs !== undefined ? { runTimeoutMs: ctx.runTimeoutMs } : undefined;
  let exampleAnswered = false;

  const property = fc.asyncProperty(arb, async (units): Promise<boolean> => {
    if (!exampleAnswered && sameUnits(units, startUnits)) {
      exampleAnswered = true;
      return false; // Known failing: answered from the recorded Mismatch, no Oracle call.
    }
    if (fatal !== null || isAborted(ctx.signal)) return true;
    if (oracleCalls >= ctx.limit) {
      limitReached = true;
      return true;
    }
    const lines = ctx.fields.map((f, i) => formatScaled(units[i] ?? 0n, fineScale(f)));
    oracleCalls++;
    try {
      const result = await ctx.oracle.runCompiled(ctx.handle, lines, runOptions);
      if (result.status !== "ok") return true;
      const outcome = await invokeCandidate(ctx.candidate, lines);
      if (outcome.kind === "output" && outputsEqual(result.stdout, outcome.text)) return true;
      best.input = lines;
      best.oracleOutput = result.stdout;
      best.candidateOutput = outcome.text;
      return false;
    } catch (error: unknown) {
      fatal = { error };
      return true;
    }
  });

  await fc.check(property, {
    examples: [[startUnits]],
    seed: ctx.seed,
    numRuns: 1,
    endOnFailure: false,
  });

  if (fatal !== null) {
    throw (fatal as { readonly error: unknown }).error;
  }
  return finish();
}
