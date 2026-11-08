import type { z } from "zod";
import type * as schemas from "@/lib/api/schemas";
export type Farm = z.infer<typeof schemas.farmSchema>;
export type Field = z.infer<typeof schemas.fieldSchema>;
export type DeviceStatus = z.infer<typeof schemas.deviceSchema>;
export type Metric = z.infer<typeof schemas.metricSchema>;
export type Quality = z.infer<typeof schemas.qualitySchema>;
export type Health = z.infer<typeof schemas.healthSchema>;
export type Alert = z.infer<typeof schemas.alertSchema>;
export type Latest = z.infer<typeof schemas.latestSchema>;
export type Series = z.infer<typeof schemas.seriesSchema>;
export type IndicatorRow = z.infer<typeof schemas.indicatorRowSchema>;
export type QualityDay = z.infer<typeof schemas.qualityDaySchema>;
export type DeviceQuality = z.infer<typeof schemas.deviceQualitySchema>;
export type DeviceContinuity = z.infer<typeof schemas.deviceContinuitySchema>;
export type Envelope<T> = {
  data: T;
  meta: { asOf: string; source: "cassandra" | "trino" };
};
