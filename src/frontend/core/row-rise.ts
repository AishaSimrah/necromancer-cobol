export const ROW_RISE_LIMIT = 20;

export function rowRiseClass(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= ROW_RISE_LIMIT) return undefined;
  return `row-rise row-rise-${index}`;
}
