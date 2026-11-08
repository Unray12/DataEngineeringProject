import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { DATA_MODE: "api", API_BASE_URL: "http://api.test", API_KEY: "secret" },
}));

import { getCompare, getSummary } from "@/features/insights/server";

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("api mode against FastAPI-shaped payloads", () => {
  it("maps /summary rows, renames relative_humidity and drops SQL-null rows", async () => {
    const fetchMock = stubFetch({
      rows: [
        { metric: "soil_moisture", min: 30, max: 60, avg: 45.5, count: 100 },
        { metric: "relative_humidity", min: "50", max: "90", avg: "70.25", count: "40" },
        { metric: "rainfall", min: null, max: null, avg: null, count: 0 },
        { metric: "pressure", min: 1, max: 2, avg: 1.5, count: 3 },
      ],
    });
    const result = await getSummary("2026-11-01", "2026-11-07");
    expect(result.meta.source).toBe("trino");
    expect(result.data.map((row) => row.metric)).toEqual(["soil_moisture", "air_humidity"]);
    expect(result.data[1]).toEqual({ metric: "air_humidity", min: 50, max: 90, avg: 70.25, count: 40 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/summary?from=2026-11-01&to=2026-11-07");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret");
  });

  it("asks FastAPI for relative_humidity when the UI asks for air_humidity", async () => {
    const fetchMock = stubFetch({
      rows: [{ field_id: "F001", avg: 70, min: 50, max: 90, count: 12 }],
    });
    const result = await getCompare(["F001", "F002"], "air_humidity", "2026-11-01", "2026-11-07");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    const query = new URL(url).searchParams;
    expect(query.get("metric")).toBe("relative_humidity");
    expect(query.get("field_ids")).toBe("F001,F002");
    expect(result.data).toEqual([
      { fieldId: "F001", avg: 70, min: 50, max: 90, count: 12, timeInRangePct: null },
    ]);
  });

  it("raises an error with the upstream status when FastAPI fails", async () => {
    stubFetch({ detail: "Trino unavailable" }, 503);
    await expect(getSummary("2026-11-01", "2026-11-07")).rejects.toMatchObject({ status: 503 });
  });

  it("rejects a payload without rows", async () => {
    stubFetch({ unexpected: true });
    await expect(getSummary("2026-11-01", "2026-11-07")).rejects.toMatchObject({ status: 502 });
  });
});
