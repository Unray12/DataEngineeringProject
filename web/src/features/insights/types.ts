import { z } from "zod";
import { envelopeSchema } from "@/lib/api/schemas";

export const METRICS = [
  "soil_moisture",
  "soil_temperature",
  "air_temperature",
  "air_humidity",
  "rainfall",
] as const;

export type Metric = (typeof METRICS)[number];

export const METRIC_INFO: Record<Metric, { label: string; unit: string }> = {
  soil_moisture: { label: "Soil moisture", unit: "%" },
  soil_temperature: { label: "Soil temperature", unit: "°C" },
  air_temperature: { label: "Air temperature", unit: "°C" },
  air_humidity: { label: "Air humidity", unit: "%" },
  rainfall: { label: "Rainfall", unit: "mm" },
};

/** Decorative icon per measurement, used wherever a measurement is listed. */
export const METRIC_ICON: Record<Metric, string> = {
  soil_moisture: "💧",
  soil_temperature: "🌱",
  air_temperature: "🌡️",
  air_humidity: "☁️",
  rainfall: "🌧️",
};

export const metricSchema = z.enum(METRICS);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format");

const summaryRowSchema = z.object({
  metric: metricSchema,
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  count: z.number(),
});

const compareRowSchema = z.object({
  fieldId: z.string().min(1),
  min: z.number(),
  max: z.number(),
  avg: z.number(),
  count: z.number(),
  /** Not every backend exposes this; `null` means "not available", never 0. */
  timeInRangePct: z.number().nullable(),
});

export const summaryEnvelopeSchema = envelopeSchema(z.array(summaryRowSchema));
export const compareEnvelopeSchema = envelopeSchema(z.array(compareRowSchema));

export type SummaryRow = z.infer<typeof summaryRowSchema>;
export type CompareRow = z.infer<typeof compareRowSchema>;
export type SummaryEnvelope = z.infer<typeof summaryEnvelopeSchema>;
export type CompareEnvelope = z.infer<typeof compareEnvelopeSchema>;

const notBackwards = (value: { from?: string; to?: string }) =>
  !value.from || !value.to || value.from <= value.to;

export const summaryQuerySchema = z
  .object({ from: dateString.optional(), to: dateString.optional() })
  .refine(notBackwards, { message: "`from` must not be after `to`" });

const fieldIdSchema = z.string().regex(/^[\w.-]{1,80}$/, "Invalid field id");

export const compareQuerySchema = z
  .object({
    fieldIds: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(z.array(fieldIdSchema).min(1).max(100)),
    metric: metricSchema.default("soil_moisture"),
    from: dateString.optional(),
    to: dateString.optional(),
  })
  .refine(notBackwards, { message: "`from` must not be after `to`" });
