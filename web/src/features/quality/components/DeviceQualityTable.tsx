"use client";

import type { DeviceQuality } from "@/lib/types";
import { formatPercent } from "@/features/alerts/format";
import { flaggedCount, missingBreakdown, validRate } from "../lineage";

function count(value: number | null): string {
  return value === null ? "chưa có dữ liệu" : value.toLocaleString("en-GB");
}

type DeviceQualityTableProps = {
  rows: DeviceQuality[];
  onSelect: (row: DeviceQuality) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export function DeviceQualityTable({
  rows,
  onSelect,
  isLoading,
  error,
  onRetry,
}: DeviceQualityTableProps) {
  if (isLoading) {
    return <div className="loading-panel">Loading per-device quality…</div>;
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="font-semibold">Could not load per-device quality</p>
        <p className="muted mt-2 text-sm">{error}</p>
        {onRetry && (
          <button type="button" className="button-secondary mt-4" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <p className="font-semibold">No device quality rows</p>
        <p className="muted mt-2 text-sm">The batch layer has not produced device quality yet.</p>
      </div>
    );
  }

  const hasMissingBreakdown = rows.some((row) => missingBreakdown(row.counts).length > 0);

  return (
    <div>
      {hasMissingBreakdown && (
        <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          The serving API exposes only part of the per-device breakdown. Missing cells show “chưa có dữ
          liệu” rather than a guessed number.
        </p>
      )}
      <div className="table-scroll">
        <table className="data-table m3-sticky-first" aria-label="Data quality by device">
          <thead>
            <tr>
              <th scope="col">Device</th>
              <th scope="col" className="hidden sm:table-cell">Total</th>
              <th scope="col">Valid</th>
              <th scope="col" className="hidden md:table-cell">Duplicate</th>
              <th scope="col" className="hidden md:table-cell">Out of range</th>
              <th scope="col" className="hidden md:table-cell">Quarantined</th>
              <th scope="col" className="hidden lg:table-cell">Flagged</th>
              <th scope="col">Valid rate</th>
              <th scope="col" className="hidden sm:table-cell">Lineage</th>
              <th scope="col">
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rate = validRate(row.counts);
              const flagged = flaggedCount(row.counts);
              return (
                <tr key={row.deviceId}>
                  <td className="font-medium">{row.deviceId}</td>
                  <td className="hidden sm:table-cell">{row.counts.total.toLocaleString("en-GB")}</td>
                  <td>{row.counts.valid.toLocaleString("en-GB")}</td>
                  <td
                    className={`hidden md:table-cell ${row.counts.duplicate === null ? "muted text-xs" : ""}`}
                  >
                    {count(row.counts.duplicate)}
                  </td>
                  <td
                    className={`hidden md:table-cell ${row.counts.outOfRange === null ? "muted text-xs" : ""}`}
                  >
                    {count(row.counts.outOfRange)}
                  </td>
                  <td
                    className={`hidden md:table-cell ${row.counts.quarantined === null ? "muted text-xs" : ""}`}
                  >
                    {count(row.counts.quarantined)}
                  </td>
                  <td className={`hidden lg:table-cell ${flagged === null ? "muted text-xs" : ""}`}>
                    {flagged === null ? "chưa có dữ liệu" : flagged.toLocaleString("en-GB")}
                  </td>
                  <td className="font-semibold text-emerald-600">
                    {rate === null ? "chưa có dữ liệu" : formatPercent(rate)}
                  </td>
                  <td className={`hidden sm:table-cell ${row.lineage.length === 0 ? "muted text-xs" : ""}`}>
                    {row.lineage.length === 0 ? "chưa có dữ liệu" : `${row.lineage.length} records`}
                  </td>
                  <td>
                    <button type="button" className="link-button text-xs" onClick={() => onSelect(row)}>
                      View lineage
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted mt-3 text-xs">
        Valid rate = valid ÷ total for this device. Flagged groups duplicate, out-of-range and
        quarantined records when the API provides the breakdown.
        <span className="md:hidden"> Open a device to see every count and its lineage.</span>
      </p>
    </div>
  );
}
