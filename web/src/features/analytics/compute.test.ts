import { describe, expect, it } from "vitest";
import { alignPeriods, delta, formatDelta, irrigationMessage, rankByTimeInRange, summarize, weekStart, weeklyAverages } from "./compute";
import type { HistoryRow, IndicatorRow } from "./types";

const row = (bucket: string, avg: number, count = 10, extra: Partial<IndicatorRow> = {}): IndicatorRow => ({
  bucket,
  metric: "soil_moisture",
  min: avg - 2,
  max: avg + 2,
  avg,
  count,
  ...extra,
});

describe("summarize", () => {
  it("weights the average by readings and sums hours below target", () => {
    const result = summarize([
      row("2026-11-01", 30, 10, { time_in_range_pct: 80, hours_below_target: 2 }),
      row("2026-11-02", 40, 30, { time_in_range_pct: 100, hours_below_target: 1 }),
    ]);
    expect(result.avg).toBe(37.5);
    expect(result.min).toBe(28);
    expect(result.max).toBe(42);
    expect(result.timeInRangePct).toBe(90);
    expect(result.hoursBelowTarget).toBe(3);
  });

  it("keeps missing indicators as null instead of 0", () => {
    const result = summarize([row("2026-11-01", 30)]);
    expect(result.timeInRangePct).toBeNull();
    expect(result.hoursBelowTarget).toBeNull();
    expect(summarize([]).avg).toBeNull();
  });
});

describe("delta", () => {
  it("reports absolute and relative change", () => {
    expect(delta(45, 40)).toEqual({ abs: 5, pct: 12.5, direction: "up" });
    expect(delta(36, 40)).toEqual({ abs: -4, pct: -10, direction: "down" });
    expect(delta(40, 40)?.direction).toBe("same");
  });

  it("has no relative change from zero and no change without data", () => {
    expect(delta(3, 0)?.pct).toBeNull();
    expect(delta(null, 5)).toBeNull();
    expect(formatDelta(null)).toBe("No comparison");
  });

  it("describes direction with an arrow and a sign, never colour alone", () => {
    expect(formatDelta(delta(45, 40), "%")).toBe("▲ +5.0 pts (12.5%)");
    expect(formatDelta(delta(36, 40), "°C")).toBe("▼ −4.0 °C (10.0%)");
  });
});

describe("periods and weeks", () => {
  const history = (values: number[], start = 1): HistoryRow[] =>
    values.map((avg, index) => ({ bucket: `2026-11-0${start + index}`, metric: "soil_moisture", min: avg, max: avg, avg, count: 1 }));

  it("aligns two periods by position and pads the shorter one", () => {
    const aligned = alignPeriods(history([1, 2, 3]), history([5, 6], 1));
    expect(aligned.map((point) => [point.current, point.previous])).toEqual([[1, 5], [2, 6], [3, null]]);
  });

  it("finds the Monday of a week, also for hourly buckets", () => {
    expect(weekStart("2026-11-04")).toBe("2026-11-02");
    expect(weekStart("2026-11-08 13:00:00")).toBe("2026-11-02");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });

  it("averages per week weighted by readings", () => {
    const rows: HistoryRow[] = [
      { bucket: "2026-11-02", metric: "soil_moisture", min: 0, max: 0, avg: 10, count: 1 },
      { bucket: "2026-11-03", metric: "soil_moisture", min: 0, max: 0, avg: 20, count: 3 },
      { bucket: "2026-11-09", metric: "soil_moisture", min: 0, max: 0, avg: 30, count: 2 },
    ];
    expect(weeklyAverages(rows)).toEqual([
      { week: "2026-11-02", avg: 17.5, readings: 4 },
      { week: "2026-11-09", avg: 30, readings: 2 },
    ]);
  });
});

describe("irrigation and ranking", () => {
  it("writes a sentence for each situation", () => {
    expect(irrigationMessage("Field 3", 9, 7)).toBe("Field 3 spent 9 hours below its soil-moisture target over the last 7 days. Consider irrigating.");
    expect(irrigationMessage("Field 3", 1, 1)).toContain("1 hour below");
    expect(irrigationMessage("Field 3", 0, 7)).toContain("No irrigation needed");
    expect(irrigationMessage("Field 3", null, 7)).toContain("no soil-moisture target");
  });

  it("ranks by time in range with missing values last", () => {
    const ranked = rankByTimeInRange([
      { id: "a", time_in_range_pct: null, avg: 50 },
      { id: "b", time_in_range_pct: 70, avg: 30 },
      { id: "c", time_in_range_pct: 95, avg: 20 },
    ]);
    expect(ranked.map((item) => [item.id, item.rank])).toEqual([["c", 1], ["b", 2], ["a", 3]]);
  });
});
