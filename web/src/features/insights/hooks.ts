"use client";

import { useQueries, useQuery, type UseQueryOptions } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { errorBodySchema } from "@/lib/api/schemas";
import type { DateRange } from "./range";
import {
  METRICS,
  compareEnvelopeSchema,
  summaryEnvelopeSchema,
  type CompareEnvelope,
  type CompareRow,
  type Metric,
  type SummaryEnvelope,
} from "./types";

async function getJson<T>(url: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(url);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body);
    throw new Error(parsed.success && parsed.data.error ? parsed.data.error : "Could not load the data.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("The server returned data in an unexpected shape.");
  return parsed.data;
}

/** Analytical data: no polling, refetched only when the filters change. */
const ANALYTICAL = { staleTime: 60_000, refetchOnWindowFocus: false } as const;

export function useSummary(range: DateRange, label: string) {
  return useQuery<SummaryEnvelope>({
    queryKey: ["summary", label, range.from, range.to],
    queryFn: () => getJson(`/api/summary?from=${range.from}&to=${range.to}`, summaryEnvelopeSchema),
    ...ANALYTICAL,
  });
}

function compareOptions(fieldIds: string[], metric: Metric, range: DateRange): UseQueryOptions<CompareEnvelope> {
  return {
    queryKey: ["compare", metric, range.from, range.to, fieldIds.join(",")],
    queryFn: () =>
      getJson(
        `/api/compare?fieldIds=${encodeURIComponent(fieldIds.join(","))}&metric=${metric}&from=${range.from}&to=${range.to}`,
        compareEnvelopeSchema,
      ),
    enabled: fieldIds.length > 0,
    ...ANALYTICAL,
  };
}

export function useCompare(fieldIds: string[], metric: Metric, range: DateRange) {
  return useQuery<CompareEnvelope>(compareOptions(fieldIds, metric, range));
}

type FieldInsightRows = Record<Metric, { current: CompareRow[]; previous: CompareRow[] }>;

/**
 * Every measurement for two periods, so one field can be described and ranked
 * against the others. Ranking needs all fields, hence `fieldIds` is the full list.
 */
export function useFieldInsights(fieldIds: string[], range: DateRange, previous: DateRange) {
  const queries = useQueries({
    queries: METRICS.flatMap((metric) => [
      compareOptions(fieldIds, metric, range),
      compareOptions(fieldIds, metric, previous),
    ]),
  });
  const rows = Object.fromEntries(
    METRICS.map((metric, index) => [
      metric,
      {
        current: queries[index * 2].data?.data ?? [],
        previous: queries[index * 2 + 1].data?.data ?? [],
      },
    ]),
  ) as FieldInsightRows;
  return {
    rows,
    isLoading: queries.some((query) => query.isLoading),
    error: queries.find((query) => query.error)?.error ?? null,
    asOf: queries[0].data?.meta.asOf,
    refetch: () => queries.forEach((query) => void query.refetch()),
  };
}
