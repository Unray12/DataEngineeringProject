import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function deviceQuality() {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://api.test");
  return (await import("@/lib/api/client")).getDeviceQuality();
}

describe("device quality in api mode", () => {
  it("reads the breakdown and lineage that FastAPI now returns", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          rows: [
            {
              device_id: "F001-S01",
              total: 598,
              valid: 596,
              flagged: 2,
              last_batch_id: 116,
              duplicate: 3,
              out_of_range: 4,
              quarantined: 1,
              lineage: [
                {
                  batch_id: 116,
                  topic: "sensor.readings.v1",
                  partition: 0,
                  offset: 6231,
                  ingested_at: "2026-11-09T15:09:09.994000Z",
                },
              ],
            },
          ],
        }),
      ),
    );
    const { data } = await deviceQuality();
    expect(data[0].counts).toMatchObject({ valid: 596, duplicate: 3, outOfRange: 4, quarantined: 1, total: 598 });
    expect(data[0].lineage).toEqual([
      { batchId: 116, topic: "sensor.readings.v1", partition: 0, offset: 6231, ingestedAt: "2026-11-09T15:09:09.994000Z" },
    ]);
  });

  it("still tolerates an older API without the breakdown or lineage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ rows: [{ device_id: "F001-S01", total: 10, valid: 9, flagged: 1, last_batch_id: 5 }] }),
      ),
    );
    const { data } = await deviceQuality();
    expect(data[0].counts.duplicate).toBeNull();
    expect(data[0].lineage).toEqual([]);
  });
});
