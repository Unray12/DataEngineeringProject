import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as getCompare } from "@/app/api/compare/route";
import { GET as getSummary } from "@/app/api/summary/route";
import { compareEnvelopeSchema, summaryEnvelopeSchema } from "@/features/insights/types";
import { fields } from "@/lib/mock/base";

const request = (path: string) => new NextRequest(`http://localhost${path}`);
const ids = fields.map((field) => field.id).join(",");

describe("GET /api/summary", () => {
  it("returns a Trino-tagged envelope that satisfies the schema", async () => {
    const response = await getSummary(request("/api/summary?from=2026-11-01&to=2026-11-07"));
    expect(response.status).toBe(200);
    const parsed = summaryEnvelopeSchema.parse(await response.json());
    expect(parsed.meta.source).toBe("trino");
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it("rejects malformed and reversed dates", async () => {
    expect((await getSummary(request("/api/summary?from=yesterday"))).status).toBe(400);
    expect((await getSummary(request("/api/summary?from=2026-11-07&to=2026-11-01"))).status).toBe(400);
  });
});

describe("GET /api/compare", () => {
  it("returns every requested field ranked by average, highest first", async () => {
    const response = await getCompare(request(`/api/compare?fieldIds=${ids}&metric=soil_moisture`));
    expect(response.status).toBe(200);
    const parsed = compareEnvelopeSchema.parse(await response.json());
    expect(parsed.meta.source).toBe("trino");
    expect(parsed.data).toHaveLength(fields.length);
    for (let index = 1; index < parsed.data.length; index += 1) {
      expect(parsed.data[index - 1].avg).toBeGreaterThanOrEqual(parsed.data[index].avg);
    }
  });

  it("is deterministic for the same request", async () => {
    const path = `/api/compare?fieldIds=${ids}&metric=air_temperature&from=2026-10-01&to=2026-10-31`;
    const first = compareEnvelopeSchema.parse(await (await getCompare(request(path))).json());
    const second = compareEnvelopeSchema.parse(await (await getCompare(request(path))).json());
    expect(second.data).toEqual(first.data);
  });

  it("ignores unknown fields in mock mode instead of inventing data", async () => {
    const response = await getCompare(request(`/api/compare?fieldIds=${fields[0].id},does-not-exist`));
    const parsed = compareEnvelopeSchema.parse(await response.json());
    expect(parsed.data.map((row) => row.fieldId)).toEqual([fields[0].id]);
  });

  it("validates the query", async () => {
    expect((await getCompare(request("/api/compare"))).status).toBe(400);
    expect((await getCompare(request("/api/compare?fieldIds=a&metric=pressure"))).status).toBe(400);
    expect((await getCompare(request("/api/compare?fieldIds=a b!"))).status).toBe(400);
  });
});
