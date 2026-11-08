const DAY_MS = 86_400_000;

export type DateRange = { from: string; to: string };

export function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Last `days` days ending on `now` (inclusive), as UTC dates. */
export function lastDays(days: number, now: number = Date.now()): DateRange {
  const length = Math.max(1, Math.floor(days));
  const to = toDateString(now);
  return { from: toDateString(Date.parse(to) - (length - 1) * DAY_MS), to };
}

/** The period of the same length that ends the day before `range` starts. */
export function previousRange(range: DateRange): DateRange {
  const length = Math.round((Date.parse(range.to) - Date.parse(range.from)) / DAY_MS) + 1;
  const to = toDateString(Date.parse(range.from) - DAY_MS);
  return { from: toDateString(Date.parse(to) - (length - 1) * DAY_MS), to };
}
