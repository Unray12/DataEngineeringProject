import { afterEach, expect, it, vi } from "vitest";
import { getLatest as mockLatest, getSeries, fields } from "@/lib/mock/base";
import {
  latestSchema,
  seriesSchema,
  indicatorRowSchema,
} from "@/lib/api/schemas";
import { getIndicators } from "@/lib/mock/base";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});
async function adapter(mode = "api") {
  vi.stubEnv("DATA_MODE", mode);
  vi.stubEnv("API_BASE_URL", "http://backend");
  return import("@/lib/api/live");
}
it("parses all live and indicator fixtures through the published schemas", () => {
  for (const field of fields) {
    expect(
      latestSchema.parse({ fieldId: field.id, metrics: mockLatest(field.id) })
        .fieldId,
    ).toBe(field.id);
    expect(
      seriesSchema.parse({
        ...getSeries(field.id, "soil_moisture"),
        fieldId: field.id,
      }).gaps,
    ).toBeDefined();
    for (const row of getIndicators(field.id, "soil_moisture"))
      expect(indicatorRowSchema.safeParse(row).success).toBe(true);
  }
});
it("serves mock fields and rejects unknown ids instead of substituting another field", async () => {
  const api = await adapter("mock");
  expect((await api.getLatest("field-h01")).data.metrics).toHaveLength(5);
  expect(
    (await api.getSeries("field-h01", "soil_moisture")).data.gaps,
  ).toHaveLength(1);
  await expect(api.getSeries("unknown", "soil_moisture")).rejects.toMatchObject(
    { status: 404 },
  );
});
it("accepts a Cassandra contract envelope and preserves the original as-of timestamp", async () => {
  const api = await adapter();
  const payload = {
    data: { fieldId: "F1", metrics: mockLatest("field-n01") },
    meta: { asOf: "2026-11-08T01:00:00Z", source: "cassandra" },
  };
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(payload));
  vi.stubGlobal("fetch", fetcher);
  expect(await api.getLatest("F1")).toEqual(payload);
  expect(fetcher.mock.calls[0]).toEqual([
    "http://backend/fields/F1/latest",
    expect.objectContaining({ cache: "no-store" }),
  ]);
});
it("rejects mismatched sources and field identities", async () => {
  const api = await adapter();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        data: { fieldId: "wrong", metrics: [] },
        meta: { asOf: new Date().toISOString(), source: "trino" },
      }),
    ),
  );
  await expect(api.getLatest("F1")).rejects.toMatchObject({
    code: "live_contract_mismatch",
  });
});
it("does not invent empty gaps or valid quality for incomplete upstream series", async () => {
  const api = await adapter();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ field_id: "F1", metric: "soil_moisture", points: [] }),
    ),
  );
  await expect(api.getSeries("F1", "soil_moisture")).rejects.toMatchObject({
    status: 502,
    code: "live_contract_mismatch",
  });
});
it("validates live route inputs before making service calls", async () => {
  vi.stubEnv("DATA_MODE", "mock");
  const { GET } = await import("@/app/api/fields/[id]/series/route");
  expect(
    (
      await GET(
        new Request(
          "http://localhost/api/fields/F1/series?metric=unknown&hours=99",
        ),
        { params: Promise.resolve({ id: "F1" }) },
      )
    ).status,
  ).toBe(400);
});
