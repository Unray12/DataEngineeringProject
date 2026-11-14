import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const row = (alert_id: string, condition_code: string, alert_type: string, metric: string | null = null) => ({
  alert_id,
  status: "open",
  created_at: "2026-11-12T10:00:00+00:00",
  field_id: "F001",
  condition_code,
  alert_type,
  severity: "warning",
  message: "test",
  metric,
});

it("classifies FastAPI alerts by condition code, not by the display text", async () => {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  const rows = [
    row("a1", "device_offline:F001-S01", "device offline"),
    row("a2", "battery_low:F001-S01", "low battery"),
    row("a3", "signal_poor:F001-S01", "poor signal"),
    row("a4", "rapid_change:soil_moisture", "rapid change", "soil_moisture"),
    row("a5", "heat_stress", "heat stress", "air_temperature"),
    row("a6", "low_relative_humidity", "low relative_humidity", "relative_humidity"),
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(rows)),
  );
  const { getAlerts } = await import("@/lib/api/client");

  const byId = Object.fromEntries((await getAlerts({ status: "open" })).data.map((alert) => [alert.id, alert]));

  expect(byId.a1.type).toBe("device_outage");
  expect(byId.a2.type).toBe("low_battery");
  expect(byId.a3.type).toBe("poor_signal");
  expect(byId.a4.type).toBe("rate_of_change");
  expect(byId.a5.type).toBe("threshold");
  expect(byId.a6.metric).toBe("air_humidity");
});
