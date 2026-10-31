import { z } from "zod";
import { alerts, devices, farms, fields, series } from "@/lib/mock/data";
import type { Alert, Device, Envelope, Farm, Field, Series } from "@/lib/types";

const env = z.object({
  DATA_MODE: z.enum(["mock", "api"]).default("mock"),
  API_BASE_URL: z.string().url().optional(),
  API_KEY: z.string().optional(),
}).parse({ DATA_MODE: process.env.DATA_MODE, API_BASE_URL: process.env.API_BASE_URL || undefined, API_KEY: process.env.API_KEY || undefined });
const envelope = <T>(data: T, source: "cassandra" | "trino" = "cassandra"): Envelope<T> => ({ data, meta: { asOf: new Date().toISOString(), source } });

export async function getDashboardData() {
  if (env.DATA_MODE === "mock") return { farms: envelope<Farm[]>(farms), fields: envelope<Field[]>(fields), devices: envelope<Device[]>(devices), alerts: envelope<Alert[]>(alerts) };
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const headers: HeadersInit = env.API_KEY ? { "x-api-key": env.API_KEY } : {};
  const fetcher = async <T>(path: string) => {
    const response = await fetch(`${env.API_BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(10_000), next: { revalidate: 30 } });
    if (!response.ok) throw new Error(`FastAPI returned ${response.status}`);
    return response.json() as Promise<T>;
  };
  const rawFarms = await fetcher<Array<{ farm_id: string; name: string; location: string; field_count: number }>>("/farms");
  const rawFields = (await Promise.all(rawFarms.map((farm) => fetcher<Array<{ field_id: string; farm_id: string; name: string; crop_code: string; area_ha: number }>>(`/farms/${farm.farm_id}/fields`)))).flat();
  const latest = await Promise.all(rawFields.map(async (field) => {
    const body = await fetcher<{ metrics: Array<{ metric: string; value: number | null }> }>(`/fields/${field.field_id}/latest`);
    return [field.field_id, body.metrics] as const;
  }));
  const latestByField = new Map(latest);
  const valueFor = (fieldId: string, metric: string) => latestByField.get(fieldId)?.find((item) => item.metric === metric)?.value ?? 0;
  const apiFields: Field[] = rawFields.map((field) => {
    const moisture = valueFor(field.field_id, "soil_moisture");
    const temperature = valueFor(field.field_id, "air_temperature");
    const humidity = valueFor(field.field_id, "relative_humidity") || valueFor(field.field_id, "air_humidity");
    const status: Field["status"] = moisture > 0 && (moisture < 25 || temperature > 35) ? "critical" : moisture > 0 && (moisture < 30 || temperature > 32) ? "attention" : "ok";
    return { id: field.field_id, farmId: field.farm_id, name: field.name, crop: field.crop_code, growthStage: "Current season", areaHa: field.area_ha, status, moisture, temperature, humidity };
  });
  const apiDevices = (await fetcher<Array<{ device_id: string; field_id: string; status: Device["status"]; last_seen: string; battery_pct: number; signal_quality: number; gap_count_24h?: number }>>("/devices")).map((device) => ({
    id: device.device_id, fieldId: device.field_id, name: device.device_id, status: device.status, lastSeen: device.last_seen, batteryPct: device.battery_pct, rssi: device.signal_quality, gapCount24h: device.gap_count_24h ?? 0,
  }));
  const apiFarms: Farm[] = rawFarms.map((farm) => ({ id: farm.farm_id, name: farm.name, region: farm.location, fieldCount: farm.field_count, deviceCount: apiDevices.filter((device) => rawFields.find((field) => field.field_id === device.fieldId)?.farm_id === farm.farm_id).length, status: "ok" }));
  const apiAlerts = (await Promise.all(["open", "acknowledged", "resolved"].map((status) => fetcher<Array<Record<string, unknown>>>(`/alerts?status=${status}`)))).flat().map((alert) => ({
    id: String(alert.alert_id), type: String(alert.alert_type ?? "threshold") as Alert["type"], severity: String(alert.severity ?? "info") as Alert["severity"], fieldId: String(alert.field_id), deviceId: alert.device_id ? String(alert.device_id) : undefined, status: String(alert.status) as Alert["status"], openedAt: String(alert.created_at), message: String(alert.message),
  }));
  const asOf = new Date().toISOString();
  return { farms: { data: apiFarms, meta: { asOf, source: "cassandra" as const } }, fields: { data: apiFields, meta: { asOf, source: "cassandra" as const } }, devices: { data: apiDevices, meta: { asOf, source: "cassandra" as const } }, alerts: { data: apiAlerts, meta: { asOf, source: "cassandra" as const } } };
}

export async function getSeries(metric: Series["metric"], fieldId = "field-n01"): Promise<Envelope<Series>> {
  if (env.DATA_MODE === "mock") return envelope(series(metric));
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}/fields/${fieldId}/series?metric=${metric}&hours=24`, { headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {}, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`);
  const body = await response.json() as { metric: Series["metric"]; points: Array<{ measured_at: string; value: number | null; quality_flag?: string }> };
  return envelope({ metric: body.metric, unit: metric === "soil_moisture" || metric === "air_humidity" ? "%" : metric === "rainfall" ? "mm" : "°C", points: body.points.map((point) => ({ t: point.measured_at, value: point.quality_flag === "invalid" ? null : point.value })), gaps: [] });
}

export function getAlerts(): Envelope<Alert[]> { return envelope(alerts); }

export async function transitionAlert(id: string, action: "acknowledge" | "resolve", note?: string): Promise<Alert> {
  if (env.DATA_MODE === "mock") {
    const alert = alerts.find((item) => item.id === id);
    if (!alert) throw new Error("Alert not found");
    alert.status = action === "resolve" ? "resolved" : "acknowledged";
    alert.note = note;
    return alert;
  }
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}/alerts/${id}`, { method: "PATCH", headers: { "content-type": "application/json", ...(env.API_KEY ? { "x-api-key": env.API_KEY } : {}) }, body: JSON.stringify({ action, note, actor: "web operator" }) });
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`);
  return await response.json() as Alert;
}

export async function getAnalyticsData(fieldId: string): Promise<Envelope<{ rows: Array<Record<string, unknown>> }>> {
  if (env.DATA_MODE === "mock") return envelope({ rows: [] }, "trino");
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}/fields/${fieldId}/history?metric=soil_moisture&granularity=daily`, { headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {}, signal: AbortSignal.timeout(10_000), next: { revalidate: 300 } });
  if (!response.ok) throw new Error(`FastAPI returned ${response.status}`);
  return envelope(await response.json() as { rows: Array<Record<string, unknown>> }, "trino");
}

export async function getQualityData(): Promise<Envelope<{ summary: Array<Record<string, unknown>>; devices: Array<Record<string, unknown>> }>> {
  if (env.DATA_MODE === "mock") return envelope({ summary: [], devices: [] }, "trino");
  if (!env.API_BASE_URL) throw new Error("API_BASE_URL is required in api mode");
  const headers: HeadersInit = env.API_KEY ? { "x-api-key": env.API_KEY } : {};
  const [summaryResponse, devicesResponse] = await Promise.all([fetch(`${env.API_BASE_URL}/quality/summary`, { headers, signal: AbortSignal.timeout(10_000), next: { revalidate: 300 } }), fetch(`${env.API_BASE_URL}/quality/devices`, { headers, signal: AbortSignal.timeout(10_000), next: { revalidate: 300 } })]);
  if (!summaryResponse.ok || !devicesResponse.ok) throw new Error("FastAPI quality endpoints failed");
  const summary = await summaryResponse.json() as { rows: Array<Record<string, unknown>> };
  const qualityDevices = await devicesResponse.json() as { rows: Array<Record<string, unknown>> };
  return envelope({ summary: summary.rows, devices: qualityDevices.rows }, "trino");
}
