import { describe, expect, it } from "vitest";
import { getSeries, MOCK_NOW } from "@/lib/mock/base";
import { chartPoints, monitoringCoverage, chartDomain } from "./continuity";
import type { Series } from "@/types";
const start = MOCK_NOW - 86_400_000;
function fixture(fieldId: string): Series {
  const row = getSeries(fieldId, "soil_moisture");
  return {
    ...row,
    fieldId,
    points: row.points.map((point) => ({
      ...point,
      quality: point.quality ?? "invalid",
    })),
  };
}
describe("BR3 coverage and gaps", () => {
  it("shows the mock outage and reduces coverage against the configured five-minute schedule", () => {
    const normal = fixture("field-n01"),
      outage = fixture("field-h01");
    expect(monitoringCoverage([normal], start, MOCK_NOW, 300)).toBe(100);
    const received = outage.points.filter(
      (point) => point.value !== null,
    ).length;
    expect(outage.gaps).toHaveLength(1);
    expect(monitoringCoverage([outage], start, MOCK_NOW, 300)).toBeCloseTo(
      (received / 288) * 100,
    );
    expect(monitoringCoverage([outage], start, MOCK_NOW, 300)).toBeLessThan(
      100,
    );
  });
  it("does not increase coverage when readings are replayed or arrive out of order", () => {
    const original = fixture("field-h01");
    const replay = {
      ...original,
      points: [...original.points, ...original.points].reverse(),
    };
    expect(monitoringCoverage([replay], start, MOCK_NOW, 300)).toBe(
      monitoringCoverage([original], start, MOCK_NOW, 300),
    );
  });
  it("excludes samples outside the window and returns unavailable for an invalid schedule", () => {
    const original = fixture("field-n01");
    expect(
      monitoringCoverage([original], MOCK_NOW, MOCK_NOW + 86_400_000, 300),
    ).toBe(0);
    expect(monitoringCoverage([], start, MOCK_NOW, 300)).toBeNull();
    expect(monitoringCoverage([original], start, MOCK_NOW, 0)).toBeNull();
  });
  it("weights all metric slots and counts invalid received measurements without treating nulls as received", () => {
    const row = fixture("field-n01");
    const empty: Series = { ...row, metric: "rainfall", points: [], gaps: [] };
    expect(monitoringCoverage([row, empty], start, MOCK_NOW, 300)).toBe(50);
  });
  it("breaks the line at declared gap boundaries even without null source points", () => {
    const row = fixture("field-h01");
    const points = chartPoints({
      ...row,
      points: row.points.filter((point) => point.value !== null),
    });
    expect(points).toContainEqual({
      time: Date.parse(row.gaps[0].start),
      value: null,
    });
    expect(points).toContainEqual({
      time: Date.parse(row.gaps[0].end),
      value: null,
    });
  });
  it("excludes suspect and invalid values from trusted chart values", () => {
    const row = fixture("field-n01");
    const points = chartPoints({
      ...row,
      points: [
        { ...row.points[0], quality: "suspect" },
        { ...row.points[1], quality: "invalid" },
      ],
    });
    expect(points.map((point) => point.value)).toEqual([null, null]);
  });
});

it("keeps an out-of-range target band within the chart domain", () => {
  const row = fixture("field-h01");
  const domain = chartDomain(row, { min: 35, max: 70 });
  expect(domain[0]).toBeLessThan(35);
  expect(domain[1]).toBeGreaterThanOrEqual(70);
});
