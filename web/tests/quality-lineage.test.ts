import { describe, expect, it } from "vitest";
import type { DeviceQuality, DeviceQualityCounts, LineageEntry } from "@/lib/types";
import {
  aggregateLineage,
  flaggedCount,
  latestLineage,
  lineageLocation,
  missingBreakdown,
  missingLineage,
  sortLineage,
  validRate,
} from "@/features/quality/lineage";

function counts(patch: Partial<DeviceQualityCounts> = {}): DeviceQualityCounts {
  return {
    valid: 90,
    duplicate: 4,
    outOfRange: 3,
    quarantined: 3,
    total: 100,
    ...patch,
  };
}

const LINEAGE: LineageEntry[] = [
  {
    batchId: 1201,
    topic: "sensor.readings.v1",
    partition: 1,
    offset: 100,
    ingestedAt: "2026-11-04T08:00:00.000Z",
  },
  {
    batchId: 1202,
    topic: "sensor.readings.v1",
    partition: 1,
    offset: 140,
    ingestedAt: "2026-11-04T09:00:00.000Z",
  },
  {
    batchId: 1202,
    topic: "sensor.readings.v1",
    partition: 2,
    offset: 120,
    ingestedAt: "2026-11-04T08:30:00.000Z",
  },
];

describe("quality lineage helpers", () => {
  it("computes the valid rate", () => {
    expect(validRate(counts())).toBe(90);
    expect(validRate(counts({ total: 0, valid: 0 }))).toBeNull();
  });

  it("computes flagged records from the breakdown", () => {
    expect(flaggedCount(counts())).toBe(10);
    expect(flaggedCount(counts({ flagged: 7 }))).toBe(7);
    expect(flaggedCount(counts({ duplicate: null }))).toBeNull();
  });

  it("reports the breakdown fields the API did not provide", () => {
    expect(missingBreakdown(counts())).toEqual([]);
    expect(missingBreakdown(counts({ duplicate: null, quarantined: null }))).toEqual([
      "duplicate",
      "quarantined",
    ]);
  });

  it("detects missing lineage", () => {
    const row: DeviceQuality = { deviceId: "d1", counts: counts(), lineage: [] };
    expect(missingLineage(row)).toBe(true);
    expect(missingLineage({ ...row, lineage: LINEAGE })).toBe(false);
  });

  it("returns the newest lineage record", () => {
    expect(latestLineage(LINEAGE)?.batchId).toBe(1202);
    expect(latestLineage(LINEAGE)?.offset).toBe(140);
    expect(latestLineage([])).toBeNull();
  });

  it("sorts lineage newest first without mutating the input", () => {
    const sorted = sortLineage(LINEAGE);
    expect(sorted.map((entry) => entry.ingestedAt)).toEqual([
      "2026-11-04T09:00:00.000Z",
      "2026-11-04T08:30:00.000Z",
      "2026-11-04T08:00:00.000Z",
    ]);
    expect(LINEAGE[0].batchId).toBe(1201);
  });

  it("aggregates batches, partitions and offsets", () => {
    const summary = aggregateLineage(LINEAGE);
    expect(summary).not.toBeNull();
    expect(summary?.batchIds).toEqual([1201, 1202]);
    expect(summary?.partitions).toEqual([1, 2]);
    expect(summary?.minOffset).toBe(100);
    expect(summary?.maxOffset).toBe(140);
    expect(summary?.latestIngestedAt).toBe("2026-11-04T09:00:00.000Z");
    expect(aggregateLineage([])).toBeNull();
  });

  it("formats a stream position", () => {
    expect(lineageLocation(LINEAGE[0])).toBe("sensor.readings.v1 · partition 1 · offset 100");
  });
});
