import type { AnalyticsField, AnalyticsResponse, Metric } from "./types";

export const mockFields: AnalyticsField[] = [
  { id: "field-n01", name: "N-01 Greenhouse", farmName: "North Valley Farm" },
  { id: "field-r01", name: "R-01 Rice Basin", farmName: "Riverside Organics" },
  { id: "field-h01", name: "H-01 Coffee", farmName: "Highland Harvest" },
];

export function mockAnalytics(metric: Metric, from: string, to: string): AnalyticsResponse {
  const base = metric === "soil_moisture" ? 38 : metric === "air_humidity" ? 68 : metric === "rainfall" ? 4 : 25;
  // One row per field (used for the comparison list).
  const perField = mockFields.slice(0, 3).map((field, index) => ({
    field_id: field.id,
    min: Number((base - 3 - index).toFixed(1)),
    max: Number((base + 4 + index).toFixed(1)),
    avg: Number((base + index * 2).toFixed(1)),
    count: 288,
  }));
  // One row per day (unique `bucket`), so list keys and the chart's x-axis stay unique.
  const days: string[] = [];
  for (let t = Date.parse(from), end = Date.parse(to); t <= end && days.length < 400; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  if (days.length === 0) days.push(from);
  const history = days.map((bucket, i) => ({
    bucket,
    metric,
    min: Number((base - 3 - (i % 3)).toFixed(1)),
    max: Number((base + 4 + (i % 3)).toFixed(1)),
    avg: Number((base + (i % 3) * 2).toFixed(1)),
    count: 288,
  }));
  return {
    history,
    indicators: history.map((row, i) => ({ ...row, time_in_range_pct: 88 - (i % 3) * 7, hours_below_target: metric === "soil_moisture" ? (i % 3) + 1 : 0 })),
    comparison: perField,
    asOf: new Date(`${to}T23:59:59.000Z`).toISOString(),
    source: "mock",
  };
}
