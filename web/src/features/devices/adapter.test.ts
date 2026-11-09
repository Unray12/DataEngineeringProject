import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function adapter(mode = "api") {
  vi.stubEnv("DATA_MODE", mode);
  vi.stubEnv("API_BASE_URL", "http://backend");
  return import("@/lib/api/devices");
}
const upstream = {
  device_id: "D1",
  field_id: "F1",
  status: "offline",
  last_seen: "2026-11-08T01:00:00Z",
  battery_pct: 72,
  rssi: -81,
  gap_count_24h: 2,
};
describe("M2 frozen device contract (BR3)", () => {
  it("normalizes the existing API into the shared device schema and envelope", async () => {
    const { getDevices, devicesEnvelopeSchema } = await adapter();
    const fetcher = vi.fn(async () => new Response(JSON.stringify([upstream])));
    vi.stubGlobal("fetch", fetcher);
    const response = await getDevices();
    expect(devicesEnvelopeSchema.parse(response).data[0]).toEqual({
      id: "D1",
      name: "D1",
      fieldId: "F1",
      status: "offline",
      lastSeen: upstream.last_seen,
      batteryPct: 72,
      rssi: -81,
      gapCount24h: 2,
    });
    expect(response.meta.source).toBe("cassandra");
    expect(Number.isFinite(Date.parse(response.meta.asOf))).toBe(true);
    expect(fetcher.mock.calls[0]).toEqual([
      "http://backend/devices",
      expect.objectContaining({ cache: "no-store" }),
    ]);
  });
  it("rejects missing counts and normalized signal instead of fabricating a count or RSSI", async () => {
    const { getDevices } = await adapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify([
              {
                device_id: "D1",
                field_id: "F1",
                status: "online",
                last_seen: upstream.last_seen,
                battery_pct: 72,
                signal_quality: 0.8,
              },
            ]),
          ),
      ),
    );
    await expect(getDevices()).rejects.toMatchObject({
      status: 502,
      code: "device_contract_mismatch",
    });
  });
  it("rejects malformed observation timestamps", async () => {
    const { getDevices } = await adapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([{ ...upstream, last_seen: "bad" }])),
      ),
    );
    await expect(getDevices()).rejects.toMatchObject({
      code: "device_contract_mismatch",
    });
  });
  it("reads one status through the existing GET endpoint and validates identity", async () => {
    const { getDeviceStatus } = await adapter();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(upstream)),
    );
    vi.stubGlobal("fetch", fetcher);
    expect((await getDeviceStatus("D1")).data.id).toBe("D1");
    expect(fetcher.mock.calls[0][0]).toBe("http://backend/devices/D1/status");
    await expect(getDeviceStatus("D2")).rejects.toMatchObject({
      code: "device_contract_mismatch",
    });
  });
  it("surfaces a service error without mock fallback", async () => {
    const { getDevices } = await adapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    await expect(getDevices()).rejects.toMatchObject({ status: 503 });
  });
  it("preserves the canonical mock device health and gap counts", async () => {
    const { getDevices } = await adapter("mock");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { devices } = await import("@/lib/mock/data");
    expect((await getDevices()).data).toEqual(devices);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("accepts FastAPI device rows: signal quality becomes the signal value", async () => {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  vi.resetModules();
  const api = await import("@/lib/api/devices");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([
        {
          device_id: "F001-S01",
          field_id: "F001",
          status: "online",
          last_seen: "2026-11-09T15:35:48.390000+00:00",
          battery_pct: 92,
          signal_quality: 0.84,
          gap_count_24h: 3,
        },
      ]),
    ),
  );
  const result = await api.getDevices();
  expect(result.data[0]).toMatchObject({ id: "F001-S01", rssi: 0.84, gapCount24h: 3, batteryPct: 92 });
});
