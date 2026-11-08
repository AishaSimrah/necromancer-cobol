/**
 * Candidate invocation and strict output comparison.
 * No normalization is ever applied: equality is `===` on the raw strings.
 */

/** A TypeScript translation under test. Receives the ACCEPT lines, returns DISPLAY output. */
export type Candidate = (inputLines: string[]) => string | Promise<string>;

export type CandidateOutcome =
  | { readonly kind: "output"; readonly text: string }
  | { readonly kind: "error"; readonly text: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toOutcome(value: unknown): CandidateOutcome {
  if (typeof value === "string") {
    return { kind: "output", text: value };
  }
  return {
    kind: "error",
    text: `Candidate returned non-string output: ${typeof value}`,
  };
}

/**
 * Calls the candidate with a fresh copy of the lines and never throws.
 * Throws, rejections and non-string results become `{ kind: "error" }`.
 */
export async function invokeCandidate(
  candidate: Candidate,
  lines: readonly string[],
): Promise<CandidateOutcome> {
  try {
    const result: unknown = await candidate([...lines]);
    return toOutcome(result);
  } catch (error: unknown) {
    return { kind: "error", text: errorText(error) };
  }
}

/** Character-for-character equality with no normalization. */
export function outputsEqual(oracleStdout: string, candidateText: string): boolean {
  return oracleStdout === candidateText;
}
