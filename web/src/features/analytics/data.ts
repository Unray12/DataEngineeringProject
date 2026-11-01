import type { AnalyticsField, AnalyticsResponse, Metric } from "./types";

export const mockFields: AnalyticsField[] = [
  { id: "field-n01", name: "N-01 Greenhouse", farmName: "North Valley Farm" },
  { id: "field-r01", name: "R-01 Rice Basin", farmName: "Riverside Organics" },
  { id: "field-h01", name: "H-01 Coffee", farmName: "Highland Harvest" },
];

export function mockAnalytics(metric: Metric, from: string, to: string): AnalyticsResponse {
  const day = from;
  const base = metric === "soil_moisture" ? 38 : metric === "air_humidity" ? 68 : metric === "rainfall" ? 4 : 25;
  const history = mockFields.slice(0, 3).map((field, index) => ({
    bucket: day,
    metric,
    min: Number((base - 3 - index).toFixed(1)),
    max: Number((base + 4 + index).toFixed(1)),
    avg: Number((base + index * 2).toFixed(1)),
    count: 288,
  }));
  return {
    history,
    indicators: history.map((row) => ({ ...row, time_in_range_pct: 88 - history.indexOf(row) * 7, hours_below_target: metric === "soil_moisture" ? history.indexOf(row) + 1 : 0 })),
    comparison: history.map((row, index) => ({ field_id: mockFields[index].id, min: row.min, max: row.max, avg: row.avg, count: row.count })),
    asOf: new Date(`${to}T23:59:59.000Z`).toISOString(),
    source: "mock",
  };
}
