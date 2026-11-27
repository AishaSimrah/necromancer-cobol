const MIN_GHOSTS = 2;
const MAX_GHOSTS = 12;
const VERDICT_GHOST_LIMIT = 20;

function ratioOf(completed: number, target: number): number {
  if (!(target > 0) || !Number.isFinite(completed)) return 0;
  const ratio = completed / target;
  return Math.min(1, Math.max(0, ratio));
}

export function ritualGhostCount(completed: number, target: number): number {
  const ratio = ratioOf(completed, target);
  return MIN_GHOSTS + Math.floor(ratio * (MAX_GHOSTS - MIN_GHOSTS));
}

export function ritualSpeedStep(completed: number, target: number): 1 | 2 | 3 | 4 {
  const ratio = ratioOf(completed, target);
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

export function verdictGhostCount(
  mismatchCount: number,
  displayedMismatchCount: number,
  matchScore: number,
): number {
  void mismatchCount;
  if (matchScore === 1) return 0;
  return Math.min(VERDICT_GHOST_LIMIT, displayedMismatchCount);
}
