import { describe, expect, it } from "vitest";
import {
  MOCK_NOW,
  alerts,
  devices,
  farms,
  fields,
  getDeviceQuality,
  getFarms,
  getLatest,
  getQualitySummary,
  getQualityTotals,
  getSeries,
  qualityDays,
} from "@/lib/mock/base";

const MINUTE = 60_000;

describe("seeded mock dataset", () => {
  it("has the documented scale", () => {
    expect(farms).toHaveLength(3);
    expect(fields).toHaveLength(12);
    expect(devices).toHaveLength(42);
    expect(qualityDays).toHaveLength(90);
    expect(getSeries("field-n01", "soil_moisture").points).toHaveLength(288);
  });

  it("is deterministic across calls", () => {
    expect(getFarms()).toEqual(getFarms());
    expect(getLatest("field-h01")).toEqual(getLatest("field-h01"));
    expect(getSeries("field-h01", "soil_moisture")).toEqual(getSeries("field-h01", "soil_moisture"));
    expect(getQualitySummary()).toEqual(getQualitySummary());
  });

  it("exposes the outage, stale device and low battery fixtures", () => {
    const outage = devices.find((device) => device.id === "field-h01-d1");
    expect(outage?.status).toBe("offline");
    expect(MOCK_NOW - Date.parse(outage?.lastSeen ?? "")).toBe(188 * MINUTE);

    expect(devices.find((device) => device.id === "field-n02-d2")?.status).toBe("stale");
    expect(devices.find((device) => device.id === "field-r02-d1")?.batteryPct).toBe(16);
  });

  it("shows the outage as a real gap, not interpolated values", () => {
    const series = getSeries("field-h01", "soil_moisture");
    expect(series.gaps).toHaveLength(1);
    expect(series.points.some((point) => point.value === null)).toBe(true);
    expect(series.points.filter((point) => point.value === null).length).toBeGreaterThan(0);
  });

  it("marks one temperature spike as suspect", () => {
    const series = getSeries("field-h01", "air_temperature");
    const suspect = series.points.filter((point) => point.quality === "suspect");
    expect(suspect).toHaveLength(1);
  });

  it("ships an alert in every lifecycle state and the documented trigger", () => {
    const statuses = new Set(alerts.map((alert) => alert.status));
    expect(statuses).toEqual(new Set(["open", "acknowledged", "resolved"]));

    const moisture = alerts.find((alert) => alert.id === "a-1001");
    expect(moisture?.fieldId).toBe("field-h01");
    expect(moisture?.observedValue).toBe(19);
    expect(moisture?.thresholdValue).toBe(40);

    const outage = alerts.find((alert) => alert.id === "a-1007");
    expect(outage?.status).toBe("resolved");
    expect(outage?.resolvedBy).toBe("system");

    const acknowledged = alerts.find((alert) => alert.id === "a-1003");
    expect(acknowledged?.status).toBe("acknowledged");
    expect(acknowledged?.note).toBeTruthy();
  });

  it("keeps quality totals equal to the sum of the daily fixtures", () => {
    const totals = qualityDays.reduce(
      (accumulator, day) => ({
        valid: accumulator.valid + day.valid,
        duplicate: accumulator.duplicate + day.duplicate,
        outOfRange: accumulator.outOfRange + day.outOfRange,
        quarantined: accumulator.quarantined + day.quarantined,
        total: accumulator.total + day.total,
      }),
      { valid: 0, duplicate: 0, outOfRange: 0, quarantined: 0, total: 0 },
    );

    expect(getQualityTotals()).toEqual(totals);
    expect(totals.duplicate).toBeGreaterThan(0);
    expect(totals.quarantined).toBeGreaterThan(0);
  });

  it("gives every device quality row a lineage trail", () => {
    const rows = getDeviceQuality();
    expect(rows).toHaveLength(42);
    for (const row of rows) {
      expect(row.lineage).toHaveLength(3);
      expect(row.counts.total).toBe(
        row.counts.valid + (row.counts.duplicate ?? 0) + (row.counts.outOfRange ?? 0) + (row.counts.quarantined ?? 0),
      );
    }
  });
});
