export type Headline = "it-lives" | "almost-faithful" | "not-faithful";

/** Formats a match score in [0,1] as a percentage with one decimal, truncated (never rounded up to 100). */
export function formatMatchScore(matchScore: number): string {
  const score = Number.isFinite(matchScore) ? Math.min(1, Math.max(0, matchScore)) : 0;
  let tenths = Math.floor(score * 1000);
  while (tenths > 0 && tenths / 1000 > score) {
    tenths -= 1;
  }
  if (score < 1 && tenths > 999) {
    tenths = 999;
  }
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export function headlineFor(score: number): Headline {
  if (score >= 1) return "it-lives";
  if (score >= 0.9) return "almost-faithful";
  return "not-faithful";
}

export function perfectScoreLine(n: number): string {
  return `No mismatches in ${n} conclusive cases.`;
}
