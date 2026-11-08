import { z } from "zod";
import { env } from "@/lib/env";
import {
  fields,
  getLatest as mockLatest,
  getSeries as mockSeries,
} from "@/lib/mock/base";
import { apiFetch } from "./client";
import { ApiError } from "./errors";
import {
  latestEnvelopeSchema,
  latestSchema,
  seriesEnvelopeSchema,
  seriesSchema,
  metricSchema,
  qualitySchema,
  timestampSchema,
} from "./schemas";
import type { Metric, Envelope } from "@/types";

export function liveEnvelope<T>(data: T): Envelope<T> {
  return {
    data,
    meta: { asOf: new Date().toISOString(), source: "cassandra" },
  };
}
function knownMockField(id: string) {
  if (!fields.some((row) => row.id === id))
    throw new ApiError(404, "Field was not found.", "not_found");
}
function contractError(): never {
  throw new ApiError(
    502,
    "Field readings are missing agreed quality, target state or gap information. Service integration is required.",
    "live_contract_mismatch",
  );
}
const latestUpstream = z.object({
  field_id: z.string(),
  metrics: z.array(
    z.object({
      metric: metricSchema,
      value: z.number(),
      unit: z.string(),
      measured_at: timestampSchema,
      quality_flag: z.string(),
      state: z.enum(["low", "ok", "high"]),
    }),
  ),
});
function quality(value: string) {
  const normalized =
    (
      {
        ok: "valid",
        out_of_range: "invalid",
        implausible_jump: "suspect",
        late: "valid",
      } as Record<string, string>
    )[value] ?? value;
  return qualitySchema.parse(normalized);
}
export async function getLatest(fieldId: string) {
  if (env.DATA_MODE === "mock") {
    knownMockField(fieldId);
    return latestEnvelopeSchema.parse(
      liveEnvelope({ fieldId, metrics: mockLatest(fieldId) }),
    );
  }
  const raw = await apiFetch(`/fields/${encodeURIComponent(fieldId)}/latest`, {
    noStore: true,
  });
  const canonical = latestEnvelopeSchema.safeParse(raw);
  if (canonical.success) {
    if (
      canonical.data.data.fieldId !== fieldId ||
      canonical.data.meta.source !== "cassandra"
    )
      return contractError();
    return canonical.data;
  }
  const parsed = latestUpstream.safeParse(raw);
  if (!parsed.success || parsed.data.field_id !== fieldId)
    return contractError();
  return latestEnvelopeSchema.parse(
    liveEnvelope(
      latestSchema.parse({
        fieldId,
        metrics: parsed.data.metrics.map((row) => ({
          metric: row.metric,
          value: row.value,
          unit: row.unit,
          measuredAt: row.measured_at,
          quality: quality(row.quality_flag),
          state: row.state,
        })),
      }),
    ),
  );
}
const seriesUpstream = z.object({
  field_id: z.string(),
  metric: metricSchema,
  unit: z.string(),
  points: z.array(
    z.object({
      measured_at: timestampSchema,
      value: z.number().nullable(),
      quality_flag: z.string(),
    }),
  ),
  gaps: z.array(z.object({ start: timestampSchema, end: timestampSchema })),
});
export async function getSeries(fieldId: string, metric: Metric, hours = 24) {
  if (env.DATA_MODE === "mock") {
    knownMockField(fieldId);
    const generated = mockSeries(fieldId, metric);
    const end = Date.parse(generated.points[generated.points.length - 1].t);
    const start = end - hours * 3_600_000;
    return seriesEnvelopeSchema.parse(
      liveEnvelope({
        ...generated,
        fieldId,
        points: generated.points
          .map((row) => ({ ...row, quality: row.quality ?? "invalid" }))
          .filter((row) => Date.parse(row.t) > start),
        gaps: generated.gaps.filter((gap) => Date.parse(gap.end) > start),
      }),
    );
  }
  const raw = await apiFetch(
    `/fields/${encodeURIComponent(fieldId)}/series?hours=${hours}&metric=${metric}`,
    { noStore: true },
  );
  const canonical = seriesEnvelopeSchema.safeParse(raw);
  if (canonical.success) {
    if (
      canonical.data.data.fieldId !== fieldId ||
      canonical.data.data.metric !== metric ||
      canonical.data.meta.source !== "cassandra"
    )
      return contractError();
    return canonical.data;
  }
  const parsed = seriesUpstream.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.field_id !== fieldId ||
    parsed.data.metric !== metric
  )
    return contractError();
  return seriesEnvelopeSchema.parse(
    liveEnvelope(
      seriesSchema.parse({
        fieldId,
        metric,
        unit: parsed.data.unit,
        gaps: parsed.data.gaps,
        points: parsed.data.points.map((row) => ({
          t: row.measured_at,
          value: row.value,
          quality: quality(row.quality_flag),
        })),
      }),
    ),
  );
}
