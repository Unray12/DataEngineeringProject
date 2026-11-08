import { afterEach, expect, it, vi } from "vitest";
import { mockContinuity } from "./mock-continuity";
import { deviceContinuitySchema } from "@/lib/api/schemas";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("provides deterministic device-specific fixtures with an ongoing outage and no readings in gaps", () => {
  const data = deviceContinuitySchema.parse(mockContinuity("field-h01-d1"));
  expect(data).toEqual(mockContinuity("field-h01-d1"));
  if (data.availability !== "available") throw new Error("Missing fixture");
  expect(data.gaps.some((gap) => gap.end === null)).toBe(true);
  expect(data.gaps).toHaveLength(14);
  expect(data.readings.length).toBeGreaterThan(0);
  for (const row of data.readings) {
    expect(row.deviceId).toBe(data.deviceId);
    expect(
      data.gaps.some(
        (gap) =>
          Date.parse(row.measuredAt) >= Date.parse(gap.start) &&
          (gap.end === null ||
            Date.parse(row.measuredAt) <= Date.parse(gap.end)),
      ),
    ).toBe(false);
  }
});
it("reports unsupported real history explicitly without substituting demo data", async () => {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Not found", { status: 404 })),
  );
  const { getDeviceContinuity } = await import("@/lib/api/continuity");
  expect((await getDeviceContinuity("D1")).data).toMatchObject({
    availability: "unavailable",
    deviceId: "D1",
  });
});
it("does not hide service outages as unsupported history", async () => {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unavailable", { status: 503 })),
  );
  const { getDeviceContinuity } = await import("@/lib/api/continuity");
  await expect(getDeviceContinuity("D1")).rejects.toMatchObject({
    status: 503,
  });
});
it("rejects history belonging to another device", async () => {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: {
          availability: "available",
          deviceId: "D2",
          gaps: [],
          readings: [],
        },
        meta: { asOf: new Date().toISOString(), source: "cassandra" },
      }),
    ),
  );
  const { getDeviceContinuity } = await import("@/lib/api/continuity");
  await expect(getDeviceContinuity("D1")).rejects.toMatchObject({
    code: "device_contract_mismatch",
  });
});
