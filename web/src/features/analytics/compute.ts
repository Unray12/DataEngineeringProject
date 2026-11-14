/**
 * Pure functions behind the analytics page. They hold every number the page
 * shows, so the figures can be unit-tested against values worked out by hand.
 */

import type { HistoryRow, IndicatorRow } from "./types";

const round1 = (value: number) => Math.round(value * 10) / 10;
const isNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export type Summary = {
  /** Average weighted by the number of readings behind each bucket. */
  avg: number | null;
  min: number | null;
  max: number | null;
  readings: number;
  buckets: number;
  /** Mean share of readings inside the target range; `null` without a target. */
  timeInRangePct: number | null;
  /** Hours below the soil-moisture target; `null` when the metric has no such indicator. */
  hoursBelowTarget: number | null;
};

export function summarize(rows: IndicatorRow[]): Summary {
  if (rows.length === 0) {
    return { avg: null, min: null, max: null, readings: 0, buckets: 0, timeInRangePct: null, hoursBelowTarget: null };
  }
  const readings = rows.reduce((sum, row) => sum + row.count, 0);
  const weighted = readings > 0 ? rows.reduce((sum, row) => sum + row.avg * row.count, 0) / readings : null;
  const inRange = rows.map((row) => row.time_in_range_pct).filter(isNumber);
  const hours = rows.map((row) => row.hours_below_target).filter(isNumber);
  return {
    avg: weighted === null ? null : round1(weighted),
    min: round1(Math.min(...rows.map((row) => row.min))),
    max: round1(Math.max(...rows.map((row) => row.max))),
    readings,
    buckets: rows.length,
    timeInRangePct: inRange.length ? round1(inRange.reduce((sum, value) => sum + value, 0) / inRange.length) : null,
    hoursBelowTarget: hours.length ? hours.reduce((sum, value) => sum + value, 0) : null,
  };
}

export type Delta = { abs: number; pct: number | null; direction: "up" | "down" | "same" };

/** Difference between two numbers; `pct` is relative to the previous value and `null` when that is 0. */
export function delta(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (!isNumber(current) || !isNumber(previous)) return null;
  const abs = round1(current - previous);
  return {
    abs,
    pct: previous === 0 ? null : round1(((current - previous) / Math.abs(previous)) * 100),
    direction: abs === 0 ? "same" : abs > 0 ? "up" : "down",
  };
}

export function formatDelta(value: Delta | null, unit = ""): string {
  if (!value) return "No comparison";
  if (value.direction === "same") return "→ No change";
  const arrow = value.direction === "up" ? "▲" : "▼";
  const sign = value.abs > 0 ? "+" : "−";
  const amount = `${sign}${Math.abs(value.abs).toFixed(1)}${unit === "%" ? " pts" : unit ? ` ${unit}` : ""}`;
  return value.pct === null ? `${arrow} ${amount}` : `${arrow} ${amount} (${Math.abs(value.pct).toFixed(1)}%)`;
}

export type AlignedPoint = {
  index: number;
  label: string;
  current: number | null;
  previous: number | null;
  currentBucket: string | null;
  previousBucket: string | null;
};

/** Put two periods on one axis by position ("day 1", "day 2", …) so they can be overlaid. */
export function alignPeriods(current: HistoryRow[], previous: HistoryRow[]): AlignedPoint[] {
  const length = Math.max(current.length, previous.length);
  return Array.from({ length }, (_, index) => ({
    index,
    label: `${index + 1}`,
    current: current[index]?.avg ?? null,
    previous: previous[index]?.avg ?? null,
    currentBucket: current[index]?.bucket ?? null,
    previousBucket: previous[index]?.bucket ?? null,
  }));
}

/** Monday (UTC) of the week a bucket falls in, as YYYY-MM-DD. */
export function weekStart(bucket: string): string {
  const day = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

export type WeeklyPoint = { week: string; avg: number; readings: number };

/** Seasonal view: reading-weighted average per week. */
export function weeklyAverages(rows: HistoryRow[]): WeeklyPoint[] {
  const weeks = new Map<string, { sum: number; readings: number }>();
  for (const row of rows) {
    const key = weekStart(row.bucket);
    const entry = weeks.get(key) ?? { sum: 0, readings: 0 };
    entry.sum += row.avg * row.count;
    entry.readings += row.count;
    weeks.set(key, entry);
  }
  return [...weeks.entries()]
    .filter(([, entry]) => entry.readings > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, entry]) => ({ week, avg: round1(entry.sum / entry.readings), readings: entry.readings }));
}

/** Plain-language irrigation line for one field. */
export function irrigationMessage(fieldName: string, hoursBelow: number | null, days: number): string {
  const span = days === 1 ? "today" : `over the last ${days} days`;
  if (hoursBelow === null) return `${fieldName}: no soil-moisture target is available.`;
  if (hoursBelow === 0) return `${fieldName} stayed at or above its soil-moisture target ${span}. No irrigation needed.`;
  const hours = `${hoursBelow} ${hoursBelow === 1 ? "hour" : "hours"}`;
  return `${fieldName} spent ${hours} below its soil-moisture target ${span}. Consider irrigating.`;
}

export type RankedField<T> = T & { rank: number };

/** Fields ordered by time in range (highest first); fields without a value go last. */
export function rankByTimeInRange<T extends { time_in_range_pct: number | null; avg: number }>(rows: T[]): RankedField<T>[] {
  return [...rows]
    .sort((a, b) => (b.time_in_range_pct ?? -1) - (a.time_in_range_pct ?? -1) || b.avg - a.avg)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
