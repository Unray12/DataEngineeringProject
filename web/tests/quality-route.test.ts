import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as qualitySummary } from "@/app/api/quality/summary/route";
import { GET as qualityDevices } from "@/app/api/quality/devices/route";
import { getQualityTotals, qualityDays } from "@/lib/mock/base";
import type { QualitySummaryEnvelope, DeviceQualityEnvelope } from "@/lib/api/schemas";

function summaryRequest(query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/quality/summary${query}`);
}

describe("GET /api/quality/summary", () => {
  it("returns the full seeded range and matches the fixture totals", async () => {
    const response = await qualitySummary(summaryRequest());
    expect(response.status).toBe(200);
    const body = (await response.json()) as QualitySummaryEnvelope;
    expect(body.meta.source).toBe("trino");
    expect(body.data).toHaveLength(qualityDays.length);

    const totals = body.data.reduce(
      (accumulator, day) => ({
        valid: accumulator.valid + day.valid,
        duplicate: accumulator.duplicate + day.duplicate,
        outOfRange: accumulator.outOfRange + day.outOfRange,
        quarantined: accumulator.quarantined + day.quarantined,
        total: accumulator.total + day.total,
      }),
      { valid: 0, duplicate: 0, outOfRange: 0, quarantined: 0, total: 0 },
    );
    expect(totals).toEqual(getQualityTotals());
  });

  it("honours the from/to range", async () => {
    const from = qualityDays[qualityDays.length - 3].date;
    const to = qualityDays[qualityDays.length - 1].date;
    const response = await qualitySummary(summaryRequest(`?from=${from}&to=${to}`));
    const body = (await response.json()) as QualitySummaryEnvelope;
    expect(body.data).toHaveLength(3);
    expect(body.data[0].date).toBe(from);
    expect(body.data[2].date).toBe(to);
  });

  it("rejects a malformed date with 400", async () => {
    const response = await qualitySummary(summaryRequest("?from=04-11-2026"));
    expect(response.status).toBe(400);
  });

  it("rejects a reversed range with 400", async () => {
    const response = await qualitySummary(summaryRequest("?from=2026-11-05&to=2026-11-01"));
    expect(response.status).toBe(400);
  });
});

describe("GET /api/quality/devices", () => {
  it("returns per-device counts and lineage from the mock fixture", async () => {
    const response = await qualityDevices();
    expect(response.status).toBe(200);
    const body = (await response.json()) as DeviceQualityEnvelope;
    expect(body.meta.source).toBe("trino");
    expect(body.data.length).toBeGreaterThanOrEqual(40);
    expect(body.data.every((row) => row.lineage.length === 3)).toBe(true);
    expect(body.data.every((row) => row.counts.total > 0)).toBe(true);
  });
});
