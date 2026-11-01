import { z } from "zod";

export const metricSchema = z.enum(["soil_moisture", "soil_temperature", "air_temperature", "air_humidity", "rainfall"]);
export type Metric = z.infer<typeof metricSchema>;

export const granularitySchema = z.enum(["daily", "hourly"]);
export type Granularity = z.infer<typeof granularitySchema>;

export const analyticsQuerySchema = z.object({
  fieldId: z.string().min(1).max(64),
  metric: metricSchema.default("soil_moisture"),
  granularity: granularitySchema.default("daily"),
  from: z.string().date(),
  to: z.string().date(),
});

export const historyRowSchema = z.object({
  bucket: z.string(),
  metric: metricSchema,
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  count: z.number(),
});

export const indicatorRowSchema = historyRowSchema.extend({
  time_in_range_pct: z.number().nullable().optional(),
  hours_below_target: z.number().nullable().optional(),
});

export const comparisonRowSchema = z.object({
  field_id: z.string(),
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  count: z.number(),
});

export type HistoryRow = z.infer<typeof historyRowSchema>;
export type IndicatorRow = z.infer<typeof indicatorRowSchema>;
export type ComparisonRow = z.infer<typeof comparisonRowSchema>;

export const analyticsResponseSchema = z.object({
  history: z.array(historyRowSchema),
  indicators: z.array(indicatorRowSchema),
  comparison: z.array(comparisonRowSchema),
  asOf: z.string().datetime(),
  source: z.enum(["trino", "mock"]),
});
export type AnalyticsResponse = z.infer<typeof analyticsResponseSchema>;

export type AnalyticsField = { id: string; name: string; farmName: string };
