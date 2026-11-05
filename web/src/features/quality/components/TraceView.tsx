"use client";

import { useState } from "react";
import type { DeviceQuality } from "@/lib/types";
import { formatDateTime } from "@/features/alerts/format";
import { aggregateLineage, latestLineage, lineageLocation } from "../lineage";

type TraceViewProps = {
  rows: DeviceQuality[];
};

export function TraceView({ rows }: TraceViewProps) {
  const defaultId = (rows.find((row) => row.lineage.length > 0) ?? rows[0])?.deviceId ?? "";
  const [deviceId, setDeviceId] = useState("");
  const currentId = deviceId || defaultId;
  const row = rows.find((item) => item.deviceId === currentId) ?? rows[0];
  const summary = row ? aggregateLineage(row.lineage) : null;
  const latest = row ? latestLineage(row.lineage) : null;

  if (!row) {
    return (
      <p className="muted text-sm">
        chưa có dữ liệu — no device quality rows are available for traceability.
      </p>
    );
  }

  return (
    <div>
      <label className="filter-field max-w-xs">
        Pick a device value
        <select
          className="select-control"
          value={row.deviceId}
          onChange={(event) => setDeviceId(event.target.value)}
        >
          {rows.map((item) => (
            <option key={item.deviceId} value={item.deviceId}>
              {item.deviceId}
            </option>
          ))}
        </select>
      </label>

      {!summary || !latest ? (
        <p className="muted mt-4 text-sm">
          chưa có dữ liệu — this device has no lineage records in the serving API.
        </p>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Data lineage path">
          <div className="device-card">
            <p className="muted text-xs">1 · Sensor</p>
            <p className="mt-1 text-sm font-semibold">{row.deviceId}</p>
            <p className="muted mt-1 text-xs">{row.counts.total.toLocaleString("en-GB")} records</p>
          </div>
          <div className="device-card">
            <p className="muted text-xs">2 · Batch</p>
            <p className="mt-1 text-sm font-semibold">
              {summary.batchIds.length === 1 ? `#${summary.batchIds[0]}` : `#${summary.batchIds.join(", #")}`}
            </p>
            <p className="muted mt-1 text-xs">
              {summary.minOffset === summary.maxOffset
                ? `offset ${summary.minOffset}`
                : `offsets ${summary.minOffset}–${summary.maxOffset}`}
            </p>
          </div>
          <div className="device-card">
            <p className="muted text-xs">3 · Stream position</p>
            <p className="mt-1 text-sm font-semibold">{summary.topics.join(", ")}</p>
            <p className="muted mt-1 text-xs">
              partition{summary.partitions.length === 1 ? "" : "s"} {summary.partitions.join(", ")}
            </p>
          </div>
          <div className="device-card">
            <p className="muted text-xs">4 · Ingested</p>
            <p className="mt-1 text-sm font-semibold">{formatDateTime(summary.latestIngestedAt)}</p>
            <p className="muted mt-1 text-xs">{lineageLocation(latest)}</p>
          </div>
        </div>
      )}

      <p className="muted mt-4 text-xs">
        This trace follows the latest lineage record for the selected device. Older records are in the
        lineage drawer next to the device table.
      </p>
    </div>
  );
}
