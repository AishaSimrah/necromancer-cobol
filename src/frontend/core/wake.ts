export const WAKE_DELAY_MS = 3000;

export function wakeVisible(elapsedMs: number, firstByteAtMs: number | undefined): boolean {
  return firstByteAtMs === undefined && elapsedMs >= WAKE_DELAY_MS;
}
