import { z } from "zod";
import { env } from "@/lib/env";
import { mockAnalytics, mockFields } from "./data";
import { analyticsResponseSchema, type AnalyticsField, type AnalyticsResponse, type Granularity, type Metric } from "./types";

const fieldSchema = z.object({ field_id: z.string(), name: z.string(), farm_id: z.string() });
const farmSchema = z.object({ farm_id: z.string(), name: z.string() });

async function apiFetch<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {},
    signal: AbortSignal.timeout(10_000),
    next: { revalidate: 180 },
  });
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`);
  return schema.parse(await response.json());
}

export async function getAnalyticsFields(): Promise<{ fields: AnalyticsField[]; source: "trino" | "mock" }> {
  if (env.DATA_MODE === "mock") return { fields: mockFields, source: "mock" };
  const farms = await apiFetch("/farms", z.array(farmSchema));
  const fields = (await Promise.all(farms.map(async (farm) => {
    const rows = await apiFetch(`/farms/${farm.farm_id}/fields`, z.array(fieldSchema));
    return rows.map((field) => ({ id: field.field_id, name: field.name, farmName: farm.name }));
  }))).flat();
  return { fields, source: "trino" };
}

export async function getAnalytics(params: { fieldId: string; metric: Metric; granularity: Granularity; from: string; to: string }): Promise<AnalyticsResponse> {
  if (env.DATA_MODE === "mock") return mockAnalytics(params.metric, params.from, params.to);
  const apiMetric = params.metric === "air_humidity" ? "relative_humidity" : params.metric;
  const query = new URLSearchParams({ from: params.from, to: params.to, granularity: params.granularity, metric: apiMetric });
  const [history, indicators] = await Promise.all([
    apiFetch(`/fields/${params.fieldId}/history?${query}`, z.object({ rows: z.array(z.object({ bucket: z.string(), metric: z.string(), min: z.number(), max: z.number(), avg: z.number(), count: z.number() })) })),
    apiFetch(`/fields/${params.fieldId}/indicators?${query}`, z.object({ rows: z.array(z.record(z.unknown())) })),
  ]);
  const { fields } = await getAnalyticsFields();
  const comparison = await apiFetch(`/compare?field_ids=${encodeURIComponent(fields.map((field) => field.id).join(","))}&metric=${apiMetric}&from=${params.from}&to=${params.to}`, z.object({ rows: z.array(z.object({ field_id: z.string(), min: z.number(), max: z.number(), avg: z.number(), count: z.number() })) }));
  return analyticsResponseSchema.parse({
    history: history.rows,
    // The endpoint returns every metric for each day; keep only the selected one.
    indicators: indicators.rows.filter((row) => row.metric === apiMetric).map((row) => ({ bucket: String(row.bucket), metric: params.metric, min: Number(row.min), max: Number(row.max), avg: Number(row.avg), count: Number(row.count), time_in_range_pct: row.time_in_range_pct == null ? null : Number(row.time_in_range_pct), hours_below_target: row.hours_below_target == null ? null : Number(row.hours_below_target) })),
    comparison: comparison.rows,
    asOf: new Date().toISOString(),
    source: "trino",
  });
}
