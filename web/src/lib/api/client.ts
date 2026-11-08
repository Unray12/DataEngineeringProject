import { z } from "zod";
import {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  devices as mockDevices,
  farms as mockFarms,
  fields as mockFields,
  getDeviceQuality as mockDeviceQuality,
  getQualitySummary as mockQualitySummary,
  series as mockSeries,
} from "@/lib/mock/data";
import { getMockAlert, getMockAlerts, transitionMockAlert } from "@/features/alerts/mock-store";
import {
  alertSchema,
  deviceQualitySchema,
  qualityDaySchema,
  type Alert as AlertPayload,
} from "@/lib/api/schemas";
import { ApiError } from "./errors";
import type {
  Alert,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Device,
  DeviceQuality,
  Envelope,
  Farm,
  Field,
  QualityDay,
  Series,
} from "@/lib/types";

const env = z
  .object({
    DATA_MODE: z.enum(["mock", "api"]).default("mock"),
    API_BASE_URL: z.string().url().optional(),
    API_KEY: z.string().optional(),
  })
  .parse({
    DATA_MODE: process.env.DATA_MODE,
    API_BASE_URL: process.env.API_BASE_URL || undefined,
    API_KEY: process.env.API_KEY || undefined,
  });

const envelope = <T>(data: T, source: "cassandra" | "trino" = "cassandra"): Envelope<T> => ({
  data,
  meta: { asOf: new Date().toISOString(), source },
});

// ---------------------------------------------------------------------------
// Server-side FastAPI adapter
// ---------------------------------------------------------------------------

type ApiFetchOptions = {
  method?: "GET" | "PATCH" | "POST";
  body?: unknown;
  revalidate?: number;
  noStore?: boolean;
  timeoutMs?: number;
};

export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<unknown> {
  if (!env.API_BASE_URL) {
    throw new ApiError(500, "API_BASE_URL is required in api mode", "config_error");
  }

  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(env.API_KEY ? { "x-api-key": env.API_KEY } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    ...(options.noStore ? { cache: "no-store" as RequestCache } : {}),
    ...(options.revalidate !== undefined ? { next: { revalidate: options.revalidate } } : {}),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // The body is optional; the status is enough to build a useful error.
    }
    throw new ApiError(response.status, detail || `FastAPI returned ${response.status}`);
  }

  return response.json() as Promise<unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseAlertRow(value: unknown): Alert {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(502, "FastAPI returned an invalid alert row", "invalid_payload");
  }
  const row = value as Record<string, unknown>;
  const metric = asString(row.metric);
  const parsed: AlertPayload = {
    id: asString(row.alert_id ?? row.id) ?? "unknown-alert",
    type: pickEnum(row.alert_type ?? row.type, ALERT_TYPES, "threshold"),
    severity: pickEnum(row.severity, ALERT_SEVERITIES, "info"),
    fieldId: asString(row.field_id ?? row.fieldId) ?? "unknown-field",
    deviceId: asString(row.device_id ?? row.deviceId),
    metric:
      metric === "soil_moisture" ||
      metric === "soil_temperature" ||
      metric === "air_temperature" ||
      metric === "air_humidity" ||
      metric === "rainfall"
        ? metric
        : undefined,
    status: pickEnum(row.status, ALERT_STATUSES, "open"),
    openedAt: asString(row.created_at ?? row.opened_at ?? row.openedAt) ?? new Date().toISOString(),
    message: asString(row.message) ?? "Alert details are unavailable.",
    observedValue: asNumber(row.observed_value ?? row.observedValue),
    thresholdValue: asNumber(row.threshold_value ?? row.thresholdValue),
    acknowledgedAt: asString(row.acknowledged_at ?? row.acknowledgedAt),
    acknowledgedBy: asString(row.acknowledged_by ?? row.acknowledgedBy),
    resolvedAt: asString(row.resolved_at ?? row.resolvedAt),
    resolvedBy: asString(row.resolved_by ?? row.resolvedBy),
    note: asString(row.note),
  };

  const result = alertSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(502, "FastAPI returned an alert that does not match the contract", "invalid_payload");
  }
  return result.data;
}

function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));
}

function worstStatus(statuses: Array<Farm["status"]>): Farm["status"] {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("attention")) return "attention";
  return "ok";
}

async function fetchApiReference(): Promise<{ farms: Farm[]; fields: Field[]; devices: Device[] }> {
  const rawFarms = await apiFetch("/farms", { revalidate: 300 }) as Array<{
    farm_id: string;
    name: string;
    location: string;
    field_count: number;
  }>;
  const rawFields = (
    await Promise.all(
      rawFarms.map((farm) =>
        apiFetch(`/farms/${encodeURIComponent(farm.farm_id)}/fields`, { revalidate: 300 }) as Promise<
          Array<{ field_id: string; farm_id: string; name: string; crop_code: string; area_ha: number }>
        >,
      ),
    )
  ).flat();
  const latest = await Promise.all(
    rawFields.map(async (field) => {
      const body = (await apiFetch(`/fields/${encodeURIComponent(field.field_id)}/latest`, { noStore: true })) as {
        metrics: Array<{ metric: string; value: number | null }>;
      };
      return [field.field_id, body.metrics] as const;
    }),
  );
  const latestByField = new Map(latest);
  const valueFor = (fieldId: string, metric: string) =>
    latestByField.get(fieldId)?.find((item) => item.metric === metric)?.value ?? 0;

  const apiFields: Field[] = rawFields.map((field) => {
    const moisture = valueFor(field.field_id, "soil_moisture");
    const temperature = valueFor(field.field_id, "air_temperature");
    const humidity = valueFor(field.field_id, "relative_humidity") || valueFor(field.field_id, "air_humidity");
    const status: Field["status"] =
      moisture > 0 && (moisture < 25 || temperature > 35)
        ? "critical"
        : moisture > 0 && (moisture < 30 || temperature > 32)
          ? "attention"
          : "ok";
    return {
      id: field.field_id,
      farmId: field.farm_id,
      name: field.name,
      crop: field.crop_code,
      growthStage: "Current season",
      areaHa: field.area_ha,
      status,
      moisture,
      temperature,
      humidity,
    };
  });

  const apiDevices = (await apiFetch("/devices", { revalidate: 30 }) as Array<{
    device_id: string;
    field_id: string;
    status: Device["status"];
    last_seen: string;
    battery_pct: number;
    signal_quality: number;
    gap_count_24h?: number;
  }>).map((device) => ({
    id: device.device_id,
    fieldId: device.field_id,
    name: device.device_id,
    status: device.status,
    lastSeen: device.last_seen,
    batteryPct: device.battery_pct,
    rssi: device.signal_quality,
    gapCount24h: device.gap_count_24h ?? 0,
  }));

  const apiFarms: Farm[] = rawFarms.map((farm) => {
    const farmFields = rawFields.filter((field) => field.farm_id === farm.farm_id);
    const fieldIds = new Set(farmFields.map((field) => field.field_id));
    const statuses = apiFields.filter((field) => fieldIds.has(field.id)).map((field) => field.status);
    return {
      id: farm.farm_id,
      name: farm.name,
      region: farm.location,
      fieldCount: farm.field_count,
      deviceCount: apiDevices.filter((device) => fieldIds.has(device.fieldId)).length,
      status: worstStatus(statuses),
    };
  });

  return { farms: apiFarms, fields: apiFields, devices: apiDevices };
}

// ---------------------------------------------------------------------------
// Reference data shared by the alert filters and detail drawer (M3).
// Kept separate from the dashboard payload so /alerts only pulls what it needs.
// ---------------------------------------------------------------------------

export type ReferenceData = {
  farms: Envelope<Farm[]>;
  fields: Envelope<Field[]>;
  devices: Envelope<Device[]>;
};

export async function getReferenceData(): Promise<ReferenceData> {
  if (env.DATA_MODE === "mock") {
    return {
      farms: envelope<Farm[]>(mockFarms),
      fields: envelope<Field[]>(mockFields),
      devices: envelope<Device[]>(mockDevices),
    };
  }

  const reference = await fetchApiReference();
  const asOf = new Date().toISOString();
  const meta = { asOf, source: "cassandra" as const };
  return {
    farms: { data: reference.farms, meta },
    fields: { data: reference.fields, meta },
    devices: { data: reference.devices, meta },
  };
}

// ---------------------------------------------------------------------------
// Dashboard and live series (kept compatible with the existing scaffold)
// ---------------------------------------------------------------------------

export async function getDashboardData() {
  if (env.DATA_MODE === "mock") {
    return {
      farms: envelope<Farm[]>(mockFarms),
      fields: envelope<Field[]>(mockFields),
      devices: envelope<Device[]>(mockDevices),
      alerts: envelope<Alert[]>(getMockAlerts()),
    };
  }

  const reference = await fetchApiReference();
  const statuses: AlertStatus[] = ["open", "acknowledged", "resolved"];
  const rawAlerts = (
    await Promise.all(
      statuses.map((status) => apiFetch(`/alerts?status=${status}`, { noStore: true }) as Promise<unknown[]>),
    )
  ).flat();
  const apiAlerts = sortAlerts(rawAlerts.map(parseAlertRow));
  const asOf = new Date().toISOString();

  return {
    farms: { data: reference.farms, meta: { asOf, source: "cassandra" as const } },
    fields: { data: reference.fields, meta: { asOf, source: "cassandra" as const } },
    devices: { data: reference.devices, meta: { asOf, source: "cassandra" as const } },
    alerts: { data: apiAlerts, meta: { asOf, source: "cassandra" as const } },
  };
}

export async function getSeries(metric: Series["metric"], fieldId = "field-n01"): Promise<Envelope<Series>> {
  if (env.DATA_MODE === "mock") return envelope(mockSeries(metric, fieldId));

  const body = (await apiFetch(
    `/fields/${encodeURIComponent(fieldId)}/series?metric=${metric}&hours=24`,
    { noStore: true },
  )) as { metric: Series["metric"]; points: Array<{ measured_at: string; value: number | null; quality_flag?: string }> };

  return envelope({
    metric: body.metric,
    unit: metric === "soil_moisture" || metric === "air_humidity" ? "%" : metric === "rainfall" ? "mm" : "°C",
    points: body.points.map((point) => ({
      t: point.measured_at,
      value: point.quality_flag === "invalid" ? null : point.value,
      quality: point.quality_flag === "suspect" ? "suspect" : point.quality_flag === "invalid" ? "invalid" : "valid",
    })),
    gaps: [],
  });
}

// ---------------------------------------------------------------------------
// Alerts (BR8) - Cassandra-backed
// ---------------------------------------------------------------------------

export type AlertFilters = {
  status?: AlertStatus;
  severity?: AlertSeverity;
  type?: AlertType;
  fieldId?: string;
  farmId?: string;
};

function filterMockAlerts(filters: AlertFilters): Alert[] {
  const fieldIds = filters.farmId
    ? new Set(mockFields.filter((field) => field.farmId === filters.farmId).map((field) => field.id))
    : null;

  return getMockAlerts().filter((alert) => {
    if (filters.status && alert.status !== filters.status) return false;
    if (filters.severity && alert.severity !== filters.severity) return false;
    if (filters.type && alert.type !== filters.type) return false;
    if (filters.fieldId && alert.fieldId !== filters.fieldId) return false;
    if (fieldIds && !fieldIds.has(alert.fieldId)) return false;
    return true;
  });
}

export async function getAlerts(filters: AlertFilters = {}): Promise<Envelope<Alert[]>> {
  if (env.DATA_MODE === "mock") {
    return envelope(sortAlerts(filterMockAlerts(filters)), "cassandra");
  }

  const farmFieldIds = filters.farmId
    ? new Set(
        ((await apiFetch(`/farms/${encodeURIComponent(filters.farmId)}/fields`, { revalidate: 300 })) as Array<{
          field_id: string;
        }>).map((field) => field.field_id),
      )
    : null;

  const statuses: AlertStatus[] = filters.status ? [filters.status] : ["open", "acknowledged", "resolved"];
  const raw = (
    await Promise.all(
      statuses.map(
        (status) => apiFetch(`/alerts?status=${status}&limit=200`, { noStore: true }) as Promise<unknown[]>,
      ),
    )
  ).flat();

  const visible = raw.map(parseAlertRow).filter((alert) => {
    if (filters.severity && alert.severity !== filters.severity) return false;
    if (filters.type && alert.type !== filters.type) return false;
    if (filters.fieldId && alert.fieldId !== filters.fieldId) return false;
    if (farmFieldIds && !farmFieldIds.has(alert.fieldId)) return false;
    return true;
  });

  return envelope(sortAlerts(visible), "cassandra");
}

export async function getAlert(id: string): Promise<Alert | null> {
  if (env.DATA_MODE === "mock") return getMockAlert(id);
  const { data } = await getAlerts();
  return data.find((alert) => alert.id === id) ?? null;
}

export async function transitionAlert(
  id: string,
  action: "acknowledge" | "resolve",
  by: string,
  note?: string,
): Promise<Alert> {
  if (env.DATA_MODE === "mock") {
    return transitionMockAlert(id, action, by, note);
  }

  const raw = await apiFetch(`/alerts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: { action, actor: by, note: note?.trim() || undefined },
    noStore: true,
  });

  if (!raw || typeof raw !== "object") {
    throw new ApiError(502, "FastAPI returned an invalid alert", "invalid_payload");
  }
  return parseAlertRow(raw);
}

// ---------------------------------------------------------------------------
// Quality (BR4) - Trino-backed
// ---------------------------------------------------------------------------

export async function getQualitySummary(from?: string, to?: string): Promise<Envelope<QualityDay[]>> {
  if (env.DATA_MODE === "mock") {
    return envelope(
      mockQualitySummary(from, to).map((day) => qualityDaySchema.parse(day)),
      "trino",
    );
  }

  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const body = (await apiFetch(`/quality/summary${query ? `?${query}` : ""}`, { revalidate: 300 })) as {
    rows: Array<Record<string, unknown>>;
  };

  const rows = body.rows.map((row) => {
    const valid = asNumber(row.valid) ?? 0;
    const duplicate = asNumber(row.duplicate) ?? 0;
    const outOfRange = asNumber(row.out_of_range ?? row.outOfRange) ?? 0;
    const quarantined = asNumber(row.quarantined) ?? 0;
    return qualityDaySchema.parse({
      date: String(row.date),
      valid,
      duplicate,
      outOfRange,
      quarantined,
      total: asNumber(row.total) ?? valid + duplicate + outOfRange + quarantined,
    });
  });

  return envelope(rows, "trino");
}

export async function getDeviceQuality(): Promise<Envelope<DeviceQuality[]>> {
  if (env.DATA_MODE === "mock") {
    return envelope(mockDeviceQuality().map((row) => deviceQualitySchema.parse(row)), "trino");
  }

  const body = (await apiFetch("/quality/devices", { revalidate: 300 })) as {
    rows: Array<Record<string, unknown>>;
  };

  const rows = body.rows.map((row) => {
    const valid = asNumber(row.valid) ?? 0;
    const total = asNumber(row.total) ?? valid;
    return deviceQualitySchema.parse({
      deviceId: String(row.device_id),
      counts: {
        valid,
        // FastAPI exposes only total/valid/flagged today. Missing breakdown
        // fields become null so the UI can say "chưa có dữ liệu".
        duplicate: asNumber(row.duplicate) ?? null,
        outOfRange: asNumber(row.out_of_range ?? row.outOfRange) ?? null,
        quarantined: asNumber(row.quarantined) ?? null,
        total,
        flagged: asNumber(row.flagged),
      },
      // No lineage endpoint yet; the API-mode UI must say so explicitly.
      lineage: [],
      lastBatchId: asNumber(row.last_batch_id) ?? null,
    });
  });

  return envelope(rows, "trino");
}

/** Backward-compatible combined payload for the old `/api/quality` route. */
export async function getQualityData(): Promise<
  Envelope<{ summary: QualityDay[]; devices: DeviceQuality[] }>
> {
  const [summary, devices] = await Promise.all([getQualitySummary(), getDeviceQuality()]);
  return {
    data: { summary: summary.data, devices: devices.data },
    meta: { asOf: summary.meta.asOf, source: "trino" },
  };
}

// ---------------------------------------------------------------------------
// Analytical history (M4) - unchanged contract
// ---------------------------------------------------------------------------

export async function getAnalyticsData(
  fieldId: string,
): Promise<Envelope<{ rows: Array<Record<string, unknown>> }>> {
  if (env.DATA_MODE === "mock") return envelope({ rows: [] }, "trino");

  const body = (await apiFetch(
    `/fields/${encodeURIComponent(fieldId)}/history?metric=soil_moisture&granularity=daily`,
    { revalidate: 300 },
  )) as { rows: Array<Record<string, unknown>> };

  return envelope(body, "trino");
}

export type { Alert, AlertSeverity, AlertStatus, AlertType, Device, DeviceQuality, Farm, Field, QualityDay };
