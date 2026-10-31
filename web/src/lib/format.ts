export function isStale(asOf: string, thresholdSeconds = 90, now = Date.now()): boolean {
  return now - new Date(asOf).getTime() > thresholdSeconds * 1000;
}

export function seriesHasGap(points: { value: number | null }[]): boolean {
  return points.some((point) => point.value === null);
}
