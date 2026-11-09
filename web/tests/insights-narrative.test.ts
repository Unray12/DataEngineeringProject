import { describe, expect, it } from "vitest";
import {
  attentionSentences,
  attentionTiles,
  buildChanges,
  compareDirection,
  describeChange,
  describeComparison,
  describeRank,
  judgeAgainstTarget,
} from "../src/features/insights/narrative";
import type { CompareRow, SummaryRow } from "../src/features/insights/types";

const opts = { unit: "%", period: "the last 7 days", previousPeriod: "the previous 7 days" };

describe("describeChange", () => {
  it("says lower and names both averages and both periods", () => {
    expect(describeChange("soil moisture", 46, 50, opts)).toBe(
      "Soil moisture averaged 46.0% over the last 7 days, lower than the 50.0% average over the previous 7 days.",
    );
  });

  it("says higher", () => {
    expect(describeChange("soil moisture", 55, 50, opts)).toBe(
      "Soil moisture averaged 55.0% over the last 7 days, higher than the 50.0% average over the previous 7 days.",
    );
  });

  it("says the same when the averages match", () => {
    expect(describeChange("soil moisture", 50, 50.02, opts)).toBe(
      "Soil moisture averaged 50.0% over the last 7 days, the same as the 50.0% average over the previous 7 days.",
    );
  });

  it("uses the unit of the metric", () => {
    expect(describeChange("rainfall", 4, 0, { ...opts, unit: "mm" })).toBe(
      "Rainfall averaged 4.0 mm over the last 7 days, higher than the 0.0 mm average over the previous 7 days.",
    );
    expect(describeChange("air temperature", 26.94, 25, { ...opts, unit: "°C" })).toBe(
      "Air temperature averaged 26.9 °C over the last 7 days, higher than the 25.0 °C average over the previous 7 days.",
    );
  });

  it("handles missing current data", () => {
    expect(describeChange("soil moisture", null, 50, opts)).toBe("Soil moisture: no data for the last 7 days.");
    expect(describeChange("soil moisture", undefined, undefined, opts)).toBe("Soil moisture: no data for the last 7 days.");
  });

  it("handles missing earlier data", () => {
    expect(describeChange("soil moisture", 50, null, opts)).toBe(
      "Soil moisture averaged 50.0% over the last 7 days; there is no data for the previous 7 days to compare with.",
    );
  });

  it("never prints NaN", () => {
    expect(describeChange("rainfall", Number.NaN, 1)).not.toContain("NaN");
    expect(describeChange("rainfall", 1, Number.NaN)).not.toContain("NaN");
  });
});

describe("buildChanges", () => {
  const row = (metric: SummaryRow["metric"], avg: number): SummaryRow => ({ metric, avg, min: avg - 1, max: avg + 1, count: 10 });

  it("builds one sentence per metric present, in a fixed order", () => {
    const sentences = buildChanges(
      [row("air_humidity", 60), row("soil_moisture", 40)],
      [row("soil_moisture", 50)],
      { current: "the last 7 days", previous: "the previous 7 days" },
    ).map((change) => change.text);
    expect(sentences).toEqual([
      "Soil moisture averaged 40.0% over the last 7 days, lower than the 50.0% average over the previous 7 days.",
      "Air humidity averaged 60.0% over the last 7 days; there is no data for the previous 7 days to compare with.",
    ]);
  });

  it("returns nothing when there is no data", () => {
    expect(buildChanges([], [], { current: "the last 7 days", previous: "the previous 7 days" })).toEqual([]);
  });
});

describe("describeComparison", () => {
  const rows: CompareRow[] = [
    { fieldId: "a", avg: 30, min: 20, max: 40, count: 5, timeInRangePct: null },
    { fieldId: "b", avg: 60, min: 50, max: 70, count: 5, timeInRangePct: null },
  ];

  it("names the highest and lowest field", () => {
    expect(describeComparison(rows, { a: "North 1", b: "East 2" }, "soil_moisture")).toBe(
      "East 2 has the highest average soil moisture (60.0%); North 1 has the lowest (30.0%).",
    );
  });

  it("handles one field and no fields", () => {
    expect(describeComparison([rows[0]], {}, "soil_moisture")).toBe("Only a has soil moisture data (average 30.0%).");
    expect(describeComparison([], {}, "soil_moisture")).toBe("No field has soil moisture data in the selected period.");
  });
});

describe("attentionSentences", () => {
  it("says everything is fine when nothing is wrong", () => {
    expect(
      attentionSentences({
        fields: [{ id: "a", name: "A", status: "ok" }],
        alerts: [{ status: "resolved", severity: "critical" }],
        devices: [{ status: "online" }],
      }),
    ).toEqual(["All fields are within their targets, no alerts are open and every device is reporting."]);
  });

  it("lists fields, alerts and devices with correct singular and plural wording", () => {
    const sentences = attentionSentences({
      fields: [
        { id: "a", name: "A", status: "attention" },
        { id: "b", name: "B", status: "critical" },
        { id: "c", name: "C", status: "attention" },
        { id: "d", name: "D", status: "attention" },
      ],
      alerts: [
        { status: "open", severity: "critical" },
        { status: "open", severity: "info" },
        { status: "acknowledged", severity: "warning" },
      ],
      devices: [{ status: "offline" }, { status: "stale" }, { status: "stale" }],
    });
    expect(sentences).toEqual([
      "4 fields need attention: A, B, C and 1 more.",
      "2 alerts are open, 1 of them critical.",
      "1 device is offline.",
      "2 devices have not reported recently.",
    ]);
  });

  it("uses the singular for a single field", () => {
    expect(
      attentionSentences({ fields: [{ id: "a", name: "A", status: "critical" }], alerts: [], devices: [] }),
    ).toEqual(["1 field needs attention: A."]);
  });
});

describe("describeRank", () => {
  it("uses the right ordinal suffix", () => {
    expect(describeRank(1, 12)).toBe("1st of 12 fields");
    expect(describeRank(2, 12)).toBe("2nd of 12 fields");
    expect(describeRank(3, 12)).toBe("3rd of 12 fields");
    expect(describeRank(4, 12)).toBe("4th of 12 fields");
    expect(describeRank(11, 12)).toBe("11th of 12 fields");
    expect(describeRank(12, 12)).toBe("12th of 12 fields");
    expect(describeRank(21, 30)).toBe("21st of 30 fields");
  });

  it("handles a single field", () => {
    expect(describeRank(1, 1)).toBe("Only field");
  });
});

describe("compareDirection", () => {
  it("reports the direction, or none without data", () => {
    expect(compareDirection(55, 50)).toBe("higher");
    expect(compareDirection(45, 50)).toBe("lower");
    expect(compareDirection(50, 50.02)).toBe("same");
    expect(compareDirection(50, null)).toBe("none");
    expect(compareDirection(undefined, 50)).toBe("none");
  });
});

describe("judgeAgainstTarget", () => {
  const target = { min: 40, max: 60 };

  it("is on target whenever the average is inside the range, whichever way it moved", () => {
    expect(judgeAgainstTarget(50, 45, target)).toBe("on_target");
    expect(judgeAgainstTarget(45, 50, target)).toBe("on_target");
  });

  it("treats lower as good above the range and as bad below it", () => {
    expect(judgeAgainstTarget(65, 70, target)).toBe("closer");
    expect(judgeAgainstTarget(30, 35, target)).toBe("further");
    expect(judgeAgainstTarget(70, 65, target)).toBe("further");
    expect(judgeAgainstTarget(35, 30, target)).toBe("closer");
  });

  it("stays off target without a change, and is unknown without a range or a value", () => {
    expect(judgeAgainstTarget(30, 30, target)).toBe("off_target");
    expect(judgeAgainstTarget(30, null, target)).toBe("off_target");
    expect(judgeAgainstTarget(30, 30, undefined)).toBe("unknown");
    expect(judgeAgainstTarget(null, 30, target)).toBe("unknown");
  });
});

describe("attentionTiles", () => {
  it("is empty when everything is fine", () => {
    expect(
      attentionTiles({ fields: [{ id: "a", name: "A", status: "ok" }], alerts: [], devices: [{ status: "online" }] }),
    ).toEqual([]);
  });

  it("builds one tile per problem, with tone, detail and link", () => {
    const tiles = attentionTiles({
      fields: [
        { id: "a", name: "A", status: "attention" },
        { id: "b", name: "B", status: "critical" },
        { id: "c", name: "C", status: "attention" },
      ],
      alerts: [
        { status: "open", severity: "critical" },
        { status: "open", severity: "info" },
        { status: "resolved", severity: "critical" },
      ],
      devices: [{ status: "offline" }, { status: "stale" }, { status: "stale" }],
    });
    expect(tiles.map((tile) => [tile.key, tile.count, tile.tone, tile.href])).toEqual([
      ["fields", 3, "critical", "/"],
      ["alerts", 2, "critical", "/alerts"],
      ["offline", 1, "critical", "/devices"],
      ["stale", 2, "warning", "/devices"],
    ]);
    expect(tiles[0].detail).toBe("A, B and 1 more");
    expect(tiles[1].detail).toBe("1 critical");
  });
});
