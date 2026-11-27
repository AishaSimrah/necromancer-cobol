export const ANNOUNCE_MIN_INTERVAL_MS = 1000;

export function shouldAnnounce(lastAnnouncedAtMs: number | undefined, nowMs: number): boolean {
  return lastAnnouncedAtMs === undefined || nowMs - lastAnnouncedAtMs >= ANNOUNCE_MIN_INTERVAL_MS;
}
