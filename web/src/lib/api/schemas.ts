/**
 * Zod schemas for every M3 payload (WEBAPP A5).
 *
 * The browser never imports the server adapter: route handlers and client
 * hooks both parse with these schemas, so a malformed payload fails at the
 * boundary instead of leaking into the UI.
 */

import { z } from "zod";

export const metricSchema = z.enum([
  "soil_moisture",
  "soil_temperature",
  "air_temperature",
  "air_humidity",
  "rainfall",
]);

export const qualitySchema = z.enum(["valid", "suspect", "invalid"]);
export const healthSchema = z.enum(["ok", "attention", "critical"]);
export const deviceStatusSchema = z.enum(["online", "stale", "offline"]);
export const alertTypeSchema = z.enum([
  "threshold",
  "rate_of_change",
  "device_outage",
  "low_battery",
  "poor_signal",
]);
export const alertSeveritySchema = z.enum(["info", "warning", "critical"]);
export const alertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);

export const alertSchema = z.object({
  id: z.string().min(1),
  type: alertTypeSchema,
  severity: alertSeveritySchema,
  fieldId: z.string().min(1),
  deviceId: z.string().min(1).optional(),
  metric: metricSchema.optional(),
  status: alertStatusSchema,
  openedAt: z.string().min(1),
  message: z.string().min(1),
  observedValue: z.number().optional(),
  thresholdValue: z.number().optional(),
  acknowledgedAt: z.string().min(1).optional(),
  acknowledgedBy: z.string().min(1).optional(),
  resolvedAt: z.string().min(1).optional(),
  resolvedBy: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

export const farmSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().min(1),
  fieldCount: z.number().int().nonnegative(),
  deviceCount: z.number().int().nonnegative(),
  status: healthSchema,
});

const targetSchema = z.object({ min: z.number(), max: z.number() });

export const fieldSchema = z.object({
  id: z.string().min(1),
  farmId: z.string().min(1),
  name: z.string().min(1),
  crop: z.string().min(1),
  growthStage: z.string().min(1),
  areaHa: z.number().nonnegative(),
  status: healthSchema,
  moisture: z.number(),
  temperature: z.number(),
  humidity: z.number(),
  targets: z.record(z.string(), targetSchema).optional(),
});

export const deviceSchema = z.object({
  id: z.string().min(1),
  fieldId: z.string().min(1),
  name: z.string().min(1),
  status: deviceStatusSchema,
  lastSeen: z.string().min(1),
  batteryPct: z.number().min(0).max(100),
  rssi: z.number(),
  gapCount24h: z.number().int().nonnegative(),
});

export const qualityDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  outOfRange: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export const lineageEntrySchema = z.object({
  batchId: z.number().int().nonnegative(),
  topic: z.string().min(1),
  partition: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  ingestedAt: z.string().min(1),
});

export const deviceQualityCountsSchema = z.object({
  valid: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative().nullable(),
  outOfRange: z.number().int().nonnegative().nullable(),
  quarantined: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative(),
  flagged: z.number().int().nonnegative().nullable().optional(),
});

export const deviceQualitySchema = z.object({
  deviceId: z.string().min(1),
  counts: deviceQualityCountsSchema,
  lineage: z.array(lineageEntrySchema),
  lastBatchId: z.number().int().nonnegative().nullable().optional(),
});

export const envelopeMetaSchema = z.object({
  asOf: z.string().min(1),
  source: z.enum(["cassandra", "trino"]),
});

/** Generic envelope factory: `envelopeSchema(z.array(alertSchema))`. */
export function envelopeSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data, meta: envelopeMetaSchema });
}

export const alertsEnvelopeSchema = envelopeSchema(z.array(alertSchema));
export const alertEnvelopeSchema = envelopeSchema(alertSchema);
export const qualitySummaryEnvelopeSchema = envelopeSchema(
  z.array(qualityDaySchema),
);
export const deviceQualityEnvelopeSchema = envelopeSchema(
  z.array(deviceQualitySchema),
);

export const errorBodySchema = z
  .object({ error: z.string().optional(), code: z.string().optional() })
  .passthrough();

/** Only the reference data the alert filters and drawer need. */
export const alertReferenceSchema = z.object({
  farms: envelopeSchema(z.array(farmSchema)),
  fields: envelopeSchema(z.array(fieldSchema)),
  devices: envelopeSchema(z.array(deviceSchema)),
});

const emptyToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value;

export const alertQuerySchema = z.object({
  status: z.preprocess(emptyToUndefined, alertStatusSchema.optional()),
  severity: z.preprocess(emptyToUndefined, alertSeveritySchema.optional()),
  type: z.preprocess(emptyToUndefined, alertTypeSchema.optional()),
  fieldId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  farmId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export const alertActionSchema = z.enum(["acknowledge", "resolve"]);

export const alertActionInputSchema = z.object({
  action: alertActionSchema,
  by: z.string().trim().min(1).max(64),
  note: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const qualityRangeSchema = z
  .object({
    from: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
  })
  .refine((range) => !range.from || !range.to || range.from <= range.to, {
    message: "from must be on or before to",
    path: ["from"],
  });

export type Alert = z.infer<typeof alertSchema>;
export type Farm = z.infer<typeof farmSchema>;
export type Field = z.infer<typeof fieldSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type QualityDay = z.infer<typeof qualityDaySchema>;
export type LineageEntry = z.infer<typeof lineageEntrySchema>;
export type DeviceQuality = z.infer<typeof deviceQualitySchema>;
export type AlertsEnvelope = z.infer<typeof alertsEnvelopeSchema>;
export type QualitySummaryEnvelope = z.infer<
  typeof qualitySummaryEnvelopeSchema
>;
export type DeviceQualityEnvelope = z.infer<typeof deviceQualityEnvelopeSchema>;

// M2 transport contracts (WEBAPP A5). Existing M3 payloads remain compatible.
export const timestampSchema = z.string().datetime({ offset: true });
export const resourceIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const latestMetricSchema = z.object({
  metric: metricSchema,
  value: z.number().finite(),
  unit: z.string().min(1),
  measuredAt: timestampSchema,
  quality: qualitySchema,
  state: z.enum(["low", "ok", "high"]),
});
export const latestSchema = z.object({
  fieldId: resourceIdSchema,
  metrics: z.array(latestMetricSchema),
});
export const gapSchema = z
  .object({ start: timestampSchema, end: timestampSchema })
  .refine(
    (row) => Date.parse(row.start) < Date.parse(row.end),
    "Gap end must follow start",
  );
export const seriesPointSchema = z.object({
  t: timestampSchema,
  value: z.number().finite().nullable(),
  quality: qualitySchema,
});
export const seriesSchema = z.object({
  fieldId: resourceIdSchema,
  metric: metricSchema,
  unit: z.string().min(1),
  points: z.array(seriesPointSchema),
  gaps: z.array(gapSchema),
});
export const indicatorRowSchema = z.object({
  bucket: z.string().min(1),
  metric: metricSchema,
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  count: z.number().int().nonnegative(),
  timeInRangePct: z.number().min(0).max(100),
  hoursBelowTarget: z.number().nonnegative().optional(),
});
export const latestEnvelopeSchema = envelopeSchema(latestSchema);
export const seriesEnvelopeSchema = envelopeSchema(seriesSchema);
export const seriesQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24).default(24),
  metric: metricSchema,
});
// Additive, read-only device continuity proposal; the existing DeviceStatus stays frozen.
export const deviceReadingSchema = z.object({
  deviceId: resourceIdSchema,
  metric: metricSchema,
  measuredAt: timestampSchema,
  value: z.number().finite().nullable(),
  unit: z.string().min(1),
  quality: qualitySchema,
});
export const deviceGapSchema = z
  .object({ start: timestampSchema, end: timestampSchema.nullable() })
  .refine(
    (row) => row.end === null || Date.parse(row.start) < Date.parse(row.end),
    "Gap end must follow start",
  );
export const deviceContinuitySchema = z.discriminatedUnion("availability", [
  z.object({
    availability: z.literal("available"),
    deviceId: resourceIdSchema,
    gaps: z.array(deviceGapSchema),
    readings: z.array(deviceReadingSchema),
  }),
  z.object({
    availability: z.literal("unavailable"),
    deviceId: resourceIdSchema,
    reason: z.string().min(1),
  }),
]);
export const deviceContinuityEnvelopeSchema = envelopeSchema(
  deviceContinuitySchema,
);
