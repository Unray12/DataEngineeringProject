"use client";

import { useQuery } from "@tanstack/react-query";
import {
  deviceQualityEnvelopeSchema,
  errorBodySchema,
  qualitySummaryEnvelopeSchema,
} from "@/lib/api/schemas";

export type QualityRange = "7d" | "30d" | "90d";

export const QUALITY_RANGES: Array<{ value: QualityRange; label: string; days: number }> = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
];

/** Inclusive UTC date range used by `/api/quality/summary`. */
export function rangeToDates(range: QualityRange, now = new Date()): { from: string; to: string } {
  const days = QUALITY_RANGES.find((item) => item.value === range)?.days ?? 30;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function messageFrom(body: unknown, fallback: string): string {
  const parsed = errorBodySchema.safeParse(body);
  return parsed.success && parsed.data.error ? parsed.data.error : fallback;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchQualitySummary(range: QualityRange) {
  const { from, to } = rangeToDates(range);
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`/api/quality/summary?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFrom(body, "We could not load the quality summary."));
  }
  return qualitySummaryEnvelopeSchema.parse(body);
}

async function fetchDeviceQuality() {
  const response = await fetch("/api/quality/devices", {
    headers: { accept: "application/json" },
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFrom(body, "We could not load per-device quality."));
  }
  return deviceQualityEnvelopeSchema.parse(body);
}

export function useQualitySummary(range: QualityRange) {
  const { from, to } = rangeToDates(range);
  return useQuery({
    queryKey: ["quality", "summary", from, to],
    queryFn: () => fetchQualitySummary(range),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useDeviceQuality() {
  return useQuery({
    queryKey: ["quality", "devices"],
    queryFn: fetchDeviceQuality,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
