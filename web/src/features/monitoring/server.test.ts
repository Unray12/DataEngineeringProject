import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function adapter() {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  return (await import("./server")).monitoring;
}
describe("BR3 existing-schema device adapter", () => {
  it("reads existing device and reference endpoints without manufacturing missing fields", async () => {
    const monitoring = await adapter();
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method ?? "GET").toBe("GET");
      const path = new URL(url).pathname;
      const responses: Record<string, unknown> = {
        "/devices": [
          {
            device_id: "D1",
            field_id: "F1",
            status: "offline",
            last_seen: null,
          },
        ],
        "/farms": [{ farm_id: "farm1" }],
        "/farms/farm1/fields": [{ field_id: "F1" }],
      };
      if (!(path in responses)) throw new Error(`Unexpected endpoint ${path}`);
      return new Response(JSON.stringify(responses[path]));
    });
    vi.stubGlobal("fetch", fetcher);
    const result = (await monitoring("devices")) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(result.rows).toEqual([
      {
        device_id: "D1",
        field_id: "F1",
        farm_id: "farm1",
        status: "offline",
        last_seen: null,
      },
    ]);
    expect(result.rows[0]).not.toHaveProperty("reporting_interval_s");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("reads the latest gap state from the existing status endpoint", async () => {
    const monitoring = await adapter();
    const fetcher = vi.fn(
      async (_url: string) =>
        new Response(
          JSON.stringify({
            device_id: "D1",
            status: "offline",
            gap_start: "2026-11-08T01:00:00Z",
            gap_end: null,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(await monitoring("devices/D1/status")).toMatchObject({
      device_id: "D1",
      gap_start: "2026-11-08T01:00:00Z",
      source: "cassandra",
    });
    expect(fetcher.mock.calls[0][0]).toBe("http://backend/devices/D1/status");
  });
  it("surfaces service failure without substituting mock readings", async () => {
    const monitoring = await adapter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    await expect(monitoring("devices")).rejects.toThrow("503");
  });
  it("rejects routes which would require new backend tables", async () => {
    const monitoring = await adapter();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(monitoring("quality/events")).rejects.toThrow(
      "Unknown monitoring route",
    );
    await expect(monitoring("devices/D1/gaps")).rejects.toThrow(
      "Unknown monitoring route",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
