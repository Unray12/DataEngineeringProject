import { z } from "zod";
import { env } from "@/lib/env";
import { devices as mockDevices } from "@/lib/mock/data";
import type { Device, Envelope } from "@/lib/types";
import { apiFetch } from "./client";
import { ApiError } from "./errors";
import { deviceSchema, envelopeSchema } from "./schemas";

const upstreamDevice = z.object({
  device_id: z.string(),
  field_id: z.string(),
  status: z.string(),
  last_seen: z.string().nullable().optional(),
  battery_pct: z.number().nullable().optional(),
  rssi: z.number().nullable().optional(),
  gap_count_24h: z.number().nullable().optional(),
});
export const deviceEnvelopeSchema = envelopeSchema(deviceSchema);
export const devicesEnvelopeSchema = envelopeSchema(z.array(deviceSchema));
const transportDevice = deviceSchema.extend({
  lastSeen: z.string().datetime({ offset: true }),
});
function normalize(value: unknown): Device {
  const row = upstreamDevice.parse(value);
  const parsed = transportDevice.safeParse({
    id: row.device_id,
    name: row.device_id,
    fieldId: row.field_id,
    status: row.status,
    lastSeen: row.last_seen,
    batteryPct: row.battery_pct,
    rssi: row.rssi,
    gapCount24h: row.gap_count_24h,
  });
  if (!parsed.success)
    throw new ApiError(
      502,
      "Device service does not provide the agreed status, timestamp, battery, RSSI and 24-hour gap count. The M2 API contract needs integration.",
      "device_contract_mismatch",
    );
  return parsed.data;
}
function wrap<T>(data: T): Envelope<T> {
  return {
    data,
    meta: { asOf: new Date().toISOString(), source: "cassandra" },
  };
}
export async function getDevices(): Promise<Envelope<Device[]>> {
  if (env.DATA_MODE === "mock")
    return devicesEnvelopeSchema.parse(wrap(mockDevices));
  const rows = z
    .array(z.unknown())
    .parse(await apiFetch("/devices", { noStore: true }));
  return devicesEnvelopeSchema.parse(wrap(rows.map(normalize)));
}
export async function getDeviceStatus(id: string): Promise<Envelope<Device>> {
  if (env.DATA_MODE === "mock") {
    const device = mockDevices.find((row) => row.id === id);
    if (!device) throw new ApiError(404, "Device was not found", "not_found");
    return deviceEnvelopeSchema.parse(wrap(device));
  }
  const device = normalize(
    await apiFetch(`/devices/${encodeURIComponent(id)}/status`, {
      noStore: true,
    }),
  );
  if (device.id !== id)
    throw new ApiError(
      502,
      "Device service returned a different device",
      "device_contract_mismatch",
    );
  return deviceEnvelopeSchema.parse(wrap(device));
}
