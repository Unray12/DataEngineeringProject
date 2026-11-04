/**
 * Pure helpers for the quality tables and the lineage drill-down. They are
 * kept separate from React so they can be unit-tested and reused by the
 * traceability view.
 */

import type { DeviceQuality, DeviceQualityCounts, LineageEntry } from "@/lib/types";

export const QUALITY_FIELDS = ["valid", "duplicate", "outOfRange", "quarantined"] as const;
export type QualityField = (typeof QUALITY_FIELDS)[number];

export function totalRecords(counts: DeviceQualityCounts): number {
  return counts.total;
}

export function validRate(counts: DeviceQualityCounts): number | null {
  if (counts.total <= 0) return null;
  return (counts.valid / counts.total) * 100;
}

export function flaggedCount(counts: DeviceQualityCounts): number | null {
  if (counts.flagged !== undefined && counts.flagged !== null) return counts.flagged;
  const missing = counts.duplicate === null || counts.outOfRange === null || counts.quarantined === null;
  if (missing) return null;
  return (counts.duplicate ?? 0) + (counts.outOfRange ?? 0) + (counts.quarantined ?? 0);
}

/** Fields the serving API did not provide. Used to render "chưa có dữ liệu". */
export function missingBreakdown(counts: DeviceQualityCounts): QualityField[] {
  return (["duplicate", "outOfRange", "quarantined"] as const).filter(
    (field) => counts[field] === null,
  );
}

export function missingLineage(row: DeviceQuality): boolean {
  return row.lineage.length === 0;
}

export function latestLineage(entries: LineageEntry[]): LineageEntry | null {
  if (entries.length === 0) return null;
  return [...entries].sort(
    (left, right) => Date.parse(right.ingestedAt) - Date.parse(left.ingestedAt),
  )[0];
}

export type LineageSummary = {
  batchIds: number[];
  topics: string[];
  partitions: number[];
  minOffset: number;
  maxOffset: number;
  latestIngestedAt: string;
};

export function aggregateLineage(entries: LineageEntry[]): LineageSummary | null {
  if (entries.length === 0) return null;
  const batchIds = [...new Set(entries.map((entry) => entry.batchId))].sort((a, b) => a - b);
  const topics = [...new Set(entries.map((entry) => entry.topic))].sort();
  const partitions = [...new Set(entries.map((entry) => entry.partition))].sort((a, b) => a - b);
  return {
    batchIds,
    topics,
    partitions,
    minOffset: Math.min(...entries.map((entry) => entry.offset)),
    maxOffset: Math.max(...entries.map((entry) => entry.offset)),
    latestIngestedAt:
      latestLineage(entries)?.ingestedAt ?? entries[entries.length - 1].ingestedAt,
  };
}

export function lineageLocation(entry: LineageEntry): string {
  return `${entry.topic} · partition ${entry.partition} · offset ${entry.offset}`;
}

export function sortLineage(entries: LineageEntry[]): LineageEntry[] {
  return [...entries].sort(
    (left, right) => Date.parse(right.ingestedAt) - Date.parse(left.ingestedAt),
  );
}
