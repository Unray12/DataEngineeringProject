import { z } from "zod";
import { env } from "@/lib/env";
import { previousRange } from "@/features/insights/range";
import { mockAnalytics, mockFields } from "./data";
import {
  analyticsResponseSchema,
  metricSchema,
  type AnalyticsField,
  type AnalyticsQuery,
  type AnalyticsResponse,
  type ComparisonRow,
  type HistoryRow,
  type IndicatorRow,
  type Metric,
} from "./types";

const fieldSchema = z.object({ field_id: z.string(), name: z.string(), farm_id: z.string() });
const farmSchema = z.object({ farm_id: z.string(), name: z.string() });

// A SQL NULL must drop the row; `z.coerce.number()` alone would turn it into 0.
const num = z.union([z.number(), z.string()]).pipe(z.coerce.number());
const optionalNum = z.union([z.number(), z.string(), z.null()]).optional().transform((value) => (value === null || value === undefined ? null : Number(value)));
const apiRow = z.object({
  bucket: z.string(),
  metric: z.string(),
  min: num,
  max: num,
  avg: num,
  count: num,
  time_in_range_pct: optionalNum,
  hours_below_target: optionalNum,
});
const rowsSchema = z.object({
  rows: z.array(z.unknown()),
  target: z.object({ min: z.number(), max: z.number() }).nullable().optional(),
});

async function apiFetch<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {},
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 120 },
  });
  if (!response.ok) throw new Error(`FastAPI returned ${response.status} for ${path.split("?")[0]}`);
  return schema.parse(await response.json());
}

/** The platform stores humidity as `relative_humidity`; the UI contract calls it `air_humidity`. */
const toApiMetric = (metric: Metric) => (metric === "air_humidity" ? "relative_humidity" : metric);
const fromApiMetric = (value: string): Metric | null => {
  const parsed = metricSchema.safeParse(value === "relative_humidity" ? "air_humidity" : value);
  return parsed.success ? parsed.data : null;
};

/** Rows with a missing statistic (a day with no validated reading) are skipped, never shown as 0. */
async function fetchBody(path: string, metric: Metric): Promise<{ rows: IndicatorRow[]; target: { min: number; max: number } | null }> {
  const { rows, target } = await apiFetch(path, rowsSchema);
  return {
    target: target ?? null,
    rows: rows.flatMap((raw) => {
      const parsed = apiRow.safeParse(raw);
      if (!parsed.success || fromApiMetric(parsed.data.metric) !== metric) return [];
      return [{ ...parsed.data, metric }];
    }),
  };
}

const fetchRows = async (path: string, metric: Metric) => (await fetchBody(path, metric)).rows;

export async function getAnalyticsFields(): Promise<{ fields: AnalyticsField[]; source: "trino" | "mock" }> {
  if (env.DATA_MODE === "mock") return { fields: mockFields, source: "mock" };
  const farms = await apiFetch("/farms", z.array(farmSchema));
  const fields = (
    await Promise.all(
      farms.map(async (farm) => {
        const rows = await apiFetch(`/farms/${farm.farm_id}/fields`, z.array(fieldSchema));
        return rows.map((field) => ({ id: field.field_id, name: field.name, farmName: farm.name }));
      }),
    )
  ).flat();
  return { fields, source: "trino" };
}

const toHistory = (rows: IndicatorRow[]): HistoryRow[] =>
  rows.map(({ bucket, metric, min, max, avg, count }) => ({ bucket, metric, min, max, avg, count }));

function compareRow(field: AnalyticsField, rows: IndicatorRow[]): ComparisonRow | null {
  if (rows.length === 0) return null;
  const readings = rows.reduce((sum, row) => sum + row.count, 0);
  const inRange = rows.map((row) => row.time_in_range_pct).filter((value): value is number => typeof value === "number");
  const hours = rows.map((row) => row.hours_below_target).filter((value): value is number => typeof value === "number");
  return {
    field_id: field.id,
    name: field.name,
    farm_name: field.farmName,
    min: Math.min(...rows.map((row) => row.min)),
    max: Math.max(...rows.map((row) => row.max)),
    avg: Math.round((rows.reduce((sum, row) => sum + row.avg * row.count, 0) / Math.max(readings, 1)) * 10) / 10,
    count: readings,
    time_in_range_pct: inRange.length ? Math.round((inRange.reduce((sum, value) => sum + value, 0) / inRange.length) * 10) / 10 : null,
    hours_below_target: hours.length ? hours.reduce((sum, value) => sum + value, 0) : null,
  };
}

export async function getAnalytics(query: AnalyticsQuery): Promise<AnalyticsResponse> {
  if (env.DATA_MODE === "mock") return mockAnalytics(query);
  const { fieldId, metric, granularity, from, to } = query;
  const apiMetric = toApiMetric(metric);
  const previous = previousRange({ from, to });
  const url = (kind: "history" | "indicators", range: { from: string; to: string }, bucketing = granularity) =>
    `/fields/${fieldId}/${kind}?${new URLSearchParams({ from: range.from, to: range.to, granularity: bucketing, metric: apiMetric })}`;

  const { fields } = await getAnalyticsFields();
  const field = fields.find((item) => item.id === fieldId) ?? { id: fieldId, name: fieldId, farmName: "" };
  const [history, previousHistory, indicatorBody, ...perField] = await Promise.all([
    fetchRows(url("history", { from, to }), metric),
    fetchRows(url("history", previous), metric),
    fetchBody(url("indicators", { from, to }), metric),
    ...fields.map((item) =>
      fetchRows(`/fields/${item.id}/indicators?${new URLSearchParams({ from, to, granularity: "daily" })}`, metric),
    ),
  ]);
  const comparison = fields.flatMap((item, index) => compareRow(item, perField[index]) ?? []);

  return analyticsResponseSchema.parse({
    field,
    range: { from, to },
    previousRange: previous,
    target: indicatorBody.target,
    history: toHistory(history),
    previousHistory: toHistory(previousHistory),
    indicators: indicatorBody.rows,
    comparison,
    asOf: new Date().toISOString(),
    source: "trino",
  });
}
