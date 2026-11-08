import { z } from "zod";
import { env } from "@/lib/env";
import { devices, fields } from "@/lib/mock/data";

const deviceSchema = z.object({
  device_id: z.string(),
  field_id: z.string().optional(),
  farm_id: z.string().optional(),
  status: z.enum(["online", "offline", "stale", "unknown"]),
  last_seen: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  reporting_interval_s: z.number().nullable().optional(),
  gap_start: z.string().nullable().optional(),
  gap_end: z.string().nullable().optional(),
});
const statusSchema = deviceSchema
  .partial()
  .extend({ device_id: z.string(), status: deviceSchema.shape.status });

async function apiRead(path: string): Promise<unknown> {
  if (!env.API_BASE_URL)
    throw new Error("API_BASE_URL is required in api mode");
  const response = await fetch(`${env.API_BASE_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    headers: env.API_KEY ? { "x-api-key": env.API_KEY } : {},
  });
  if (!response.ok)
    throw new Error(`Monitoring service returned ${response.status}`);
  return response.json();
}

/** Read-only adapter for the existing /devices and /devices/{id}/status APIs. */
export async function monitoring(path: string): Promise<unknown> {
  if (path !== "devices" && !/^devices\/[a-zA-Z0-9_-]+\/status$/.test(path))
    throw new Error("Unknown monitoring route");
  const source = env.DATA_MODE === "mock" ? "mock" : "cassandra";
  if (env.DATA_MODE === "mock") {
    const rows = devices.map((device) => ({
      device_id: device.id,
      field_id: device.fieldId,
      farm_id: fields.find((field) => field.id === device.fieldId)?.farmId,
      status: device.status,
      last_seen: device.lastSeen,
      reporting_interval_s: null,
      gap_start: null,
      gap_end: null,
    }));
    if (path === "devices") return { rows, source };
    const device = rows.find((row) => row.device_id === path.split("/")[1]);
    if (!device) throw new Error("Unknown device");
    return { ...device, source };
  }
  if (path !== "devices")
    return { ...statusSchema.parse(await apiRead(`/${path}`)), source };
  const rows = z.array(deviceSchema).parse(await apiRead("/devices"));
  const farms = z
    .array(z.object({ farm_id: z.string() }))
    .parse(await apiRead("/farms"));
  const mappings = (
    await Promise.all(
      farms.map(async (farm) => {
        const references = z
          .array(z.object({ field_id: z.string() }))
          .parse(
            await apiRead(`/farms/${encodeURIComponent(farm.farm_id)}/fields`),
          );
        return references.map(
          (field) => [field.field_id, farm.farm_id] as const,
        );
      }),
    )
  ).flat();
  const farmByField = new Map(mappings);
  return {
    rows: rows.map((row) => ({
      ...row,
      farm_id: row.farm_id ?? farmByField.get(row.field_id ?? ""),
    })),
    source,
  };
}
