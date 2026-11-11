import { MOCK_NOW, farms as baseFarms, fields as baseFields, getIndicators } from "@/lib/mock/base";
import { previousRange } from "@/features/insights/range";
import type {
  AnalyticsField,
  AnalyticsQuery,
  AnalyticsResponse,
  ComparisonRow,
  Granularity,
  HistoryRow,
  IndicatorRow,
  Metric,
} from "./types";

const DAY_MS = 86_400_000;
const round1 = (value: number) => Math.round(value * 10) / 10;

export const mockFields: AnalyticsField[] = baseFields.map((field) => ({
  id: field.id,
  name: field.name,
  farmName: baseFarms.find((farm) => farm.id === field.farmId)?.name ?? field.farmId,
}));

/** Daily rows of the shared mock between two dates, floored at zero for rainfall. */
function dailyRows(fieldId: string, metric: Metric, from: string, to: string): IndicatorRow[] {
  const daysBack = Math.min(400, Math.max(1, Math.ceil((MOCK_NOW - Date.parse(from)) / DAY_MS) + 2));
  const floor = (value: number) => (metric === "rainfall" ? Math.max(0, value) : value);
  return getIndicators(fieldId, metric, daysBack)
    .filter((row) => row.bucket >= from && row.bucket <= to)
    .map((row) => ({
      bucket: row.bucket,
      metric,
      min: round1(floor(row.min)),
      max: round1(floor(row.max)),
      avg: round1(floor(row.avg)),
      count: row.count,
      time_in_range_pct: row.timeInRangePct,
      hours_below_target: metric === "soil_moisture" ? row.hoursBelowTarget : null,
    }));
}

/** Spread each day over 24 hours with a small daily cycle so hourly charts look like real data. */
function hourlyRows(rows: IndicatorRow[]): IndicatorRow[] {
  return rows.flatMap((row) =>
    Array.from({ length: 24 }, (_, hour) => {
      const wave = Math.sin(((hour - 6) / 24) * 2 * Math.PI) * ((row.max - row.min) / 2);
      const avg = round1(row.avg + wave);
      return {
        ...row,
        bucket: `${row.bucket} ${String(hour).padStart(2, "0")}:00:00`,
        avg,
        min: round1(avg - 0.6),
        max: round1(avg + 0.6),
        count: Math.max(1, Math.round(row.count / 24)),
        hours_below_target: row.hours_below_target === null ? null : hour < (row.hours_below_target ?? 0) ? 1 : 0,
      };
    }),
  );
}

function rowsFor(fieldId: string, metric: Metric, granularity: Granularity, from: string, to: string): IndicatorRow[] {
  const daily = dailyRows(fieldId, metric, from, to);
  return granularity === "hourly" ? hourlyRows(daily) : daily;
}

const toHistory = (rows: IndicatorRow[]): HistoryRow[] =>
  rows.map(({ bucket, metric, min, max, avg, count }) => ({ bucket, metric, min, max, avg, count }));

export function mockAnalytics(query: AnalyticsQuery): AnalyticsResponse {
  const { fieldId, metric, granularity, from, to } = query;
  const field = mockFields.find((item) => item.id === fieldId) ?? mockFields[0];
  const previous = previousRange({ from, to });
  const indicators = rowsFor(field.id, metric, granularity, from, to);
  const target = baseFields.find((item) => item.id === field.id)?.targets?.[metric] ?? null;

  const comparison: ComparisonRow[] = mockFields.flatMap((item) => {
    const rows = dailyRows(item.id, metric, from, to);
    if (rows.length === 0) return [];
    const readings = rows.reduce((sum, row) => sum + row.count, 0);
    const inRange = rows.map((row) => row.time_in_range_pct).filter((value): value is number => typeof value === "number");
    const hours = rows.map((row) => row.hours_below_target).filter((value): value is number => typeof value === "number");
    return [
      {
        field_id: item.id,
        name: item.name,
        farm_name: item.farmName,
        min: Math.min(...rows.map((row) => row.min)),
        max: Math.max(...rows.map((row) => row.max)),
        avg: round1(rows.reduce((sum, row) => sum + row.avg * row.count, 0) / readings),
        count: readings,
        time_in_range_pct: inRange.length ? round1(inRange.reduce((sum, value) => sum + value, 0) / inRange.length) : null,
        hours_below_target: hours.length ? hours.reduce((sum, value) => sum + value, 0) : null,
      },
    ];
  });

  return {
    field,
    range: { from, to },
    previousRange: previous,
    target,
    history: toHistory(indicators),
    previousHistory: toHistory(rowsFor(field.id, metric, granularity, previous.from, previous.to)),
    indicators,
    comparison,
    asOf: new Date().toISOString(),
    source: "mock",
  };
}
