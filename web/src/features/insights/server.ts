/**
 * Server-side adapter for the analytical endpoints (/summary, /compare).
 *
 * Both are Trino-backed in FastAPI, so every envelope is tagged
 * `source: "trino"`. In mock mode the numbers are derived from the shared
 * seeded indicators so they stay deterministic.
 */

import { z } from "zod";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/api/errors";
import { MOCK_NOW, fields as mockFields, getIndicators, type IndicatorRow } from "@/lib/mock/base";
import { lastDays, toDateString } from "./range";
import {
  METRICS,
  metricSchema,
  type CompareEnvelope,
  type CompareRow,
  type Metric,
  type SummaryEnvelope,
  type SummaryRow,
} from "./types";

const DAY_MS = 86_400_000;
const round1 = (value: number) => Math.round(value * 10) / 10;

function meta() {
  return { asOf: new Date().toISOString(), source: "trino" as const };
}

function resolveRange(from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  if (to) return { from: toDateString(Date.parse(to) - 6 * DAY_MS), to };
  const week = lastDays(7);
  return { from: from ?? week.from, to: from && from > week.to ? from : week.to };
}

// Mock mode

function mockRows(fieldId: string, metric: Metric, from: string, to: string): IndicatorRow[] {
  const daysBack = Math.min(400, Math.max(1, Math.ceil((MOCK_NOW - Date.parse(from)) / DAY_MS) + 2));
  return getIndicators(fieldId, metric, daysBack).filter((row) => row.bucket >= from && row.bucket <= to);
}

function aggregate(rows: IndicatorRow[], metric: Metric) {
  if (rows.length === 0) return null;
  // The shared mock is Gaussian and can dip below zero; rainfall cannot.
  const floor = (value: number) => (metric === "rainfall" ? Math.max(0, value) : value);
  const mean = (pick: (row: IndicatorRow) => number) => rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  return {
    min: round1(floor(Math.min(...rows.map((row) => row.min)))),
    max: round1(floor(Math.max(...rows.map((row) => row.max)))),
    avg: round1(floor(mean((row) => row.avg))),
    count: rows.reduce((sum, row) => sum + row.count, 0),
    timeInRangePct: round1(mean((row) => row.timeInRangePct)),
  };
}

function mockSummary(from: string, to: string): SummaryRow[] {
  return METRICS.flatMap((metric) => {
    const rows = mockFields.flatMap((field) => mockRows(field.id, metric, from, to));
    const total = aggregate(rows, metric);
    return total ? [{ metric, min: total.min, max: total.max, avg: total.avg, count: total.count }] : [];
  });
}

function mockCompare(fieldIds: string[], metric: Metric, from: string, to: string): CompareRow[] {
  const known = new Set(mockFields.map((field) => field.id));
  return fieldIds
    .filter((id) => known.has(id))
    .flatMap((fieldId) => {
      const total = aggregate(mockRows(fieldId, metric, from, to), metric);
      return total ? [{ fieldId, ...total }] : [];
    })
    .sort((left, right) => right.avg - left.avg);
}

// API mode

async function fetchApi(path: string): Promise<unknown> {
  if (!env.API_BASE_URL) throw new ApiError(500, "API_BASE_URL is required in api mode", "config_error");
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {},
    signal: AbortSignal.timeout(10_000),
    next: { revalidate: 120 },
  });
  if (!response.ok) {
    throw new ApiError(response.status, `FastAPI returned ${response.status} for ${path.split("?")[0]}`);
  }
  return response.json();
}

// A SQL NULL must drop the row; `z.coerce.number()` alone would turn it into 0.
const num = z.union([z.number(), z.string()]).pipe(z.coerce.number());
const rowsSchema = z.object({ rows: z.array(z.record(z.string(), z.unknown())) });

/** The platform stores humidity as `relative_humidity`; the UI contract calls it `air_humidity`. */
function normaliseMetric(value: unknown): Metric | null {
  const name = value === "relative_humidity" ? "air_humidity" : value;
  const parsed = metricSchema.safeParse(name);
  return parsed.success ? parsed.data : null;
}

const apiSummaryRow = z.object({ metric: z.unknown(), min: num, max: num, avg: num, count: num });
const apiCompareRow = z.object({ field_id: z.string(), min: num, max: num, avg: num, count: num });

function parseRows(body: unknown): Array<Record<string, unknown>> {
  const parsed = rowsSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(502, "FastAPI returned an unexpected analytical payload", "invalid_payload");
  return parsed.data.rows;
}

function apiSummary(body: unknown): SummaryRow[] {
  return parseRows(body).flatMap((raw) => {
    const row = apiSummaryRow.safeParse(raw);
    const metric = row.success ? normaliseMetric(row.data.metric) : null;
    return row.success && metric
      ? [{ metric, min: row.data.min, max: row.data.max, avg: row.data.avg, count: row.data.count }]
      : [];
  });
}

function apiCompare(body: unknown): CompareRow[] {
  return parseRows(body).flatMap((raw) => {
    const row = apiCompareRow.safeParse(raw);
    return row.success
      ? [{ fieldId: row.data.field_id, min: row.data.min, max: row.data.max, avg: row.data.avg, count: row.data.count, timeInRangePct: null }]
      : [];
  });
}

// Public entry points used by the route handlers

export async function getSummary(from?: string, to?: string): Promise<SummaryEnvelope> {
  const range = resolveRange(from, to);
  if (env.DATA_MODE === "mock") return { data: mockSummary(range.from, range.to), meta: meta() };
  const body = await fetchApi(`/summary?from=${range.from}&to=${range.to}`);
  return { data: apiSummary(body), meta: meta() };
}

export async function getCompare(
  fieldIds: string[],
  metric: Metric,
  from?: string,
  to?: string,
): Promise<CompareEnvelope> {
  const range = resolveRange(from, to);
  if (env.DATA_MODE === "mock") return { data: mockCompare(fieldIds, metric, range.from, range.to), meta: meta() };
  // The platform stores humidity as relative_humidity; the UI contract calls it air_humidity.
  const apiMetric = metric === "air_humidity" ? "relative_humidity" : metric;
  const query = new URLSearchParams({ field_ids: fieldIds.join(","), metric: apiMetric, from: range.from, to: range.to });
  const body = await fetchApi(`/compare?${query}`);
  return { data: apiCompare(body), meta: meta() };
}
