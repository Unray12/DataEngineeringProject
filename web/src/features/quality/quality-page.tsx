"use client";

import { useMemo, useState } from "react";
import type { DeviceQuality } from "@/lib/types";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { formatDateTime, formatNumber, formatPercent } from "@/features/alerts/format";
import { DeviceQualityTable } from "./components/DeviceQualityTable";
import { Glossary } from "./components/Glossary";
import { LineageDrawer } from "./components/LineageDrawer";
import { QualityStackedBar } from "./components/QualityStackedBar";
import { TraceView } from "./components/TraceView";
import { QUALITY_RANGES, useDeviceQuality, useQualitySummary, type QualityRange } from "./hooks";
import { missingBreakdown, missingLineage } from "./lineage";

export function QualityPage() {
  return (
    <M3QueryProvider>
      <QualityContent />
    </M3QueryProvider>
  );
}

function QualityContent() {
  const [range, setRange] = useState<QualityRange>("30d");
  const [selectedRow, setSelectedRow] = useState<DeviceQuality | null>(null);

  const summaryQuery = useQualitySummary(range);
  const devicesQuery = useDeviceQuality();

  const days = summaryQuery.data?.data ?? [];
  const devices = devicesQuery.data?.data ?? [];

  const totals = useMemo(
    () =>
      days.reduce(
        (accumulator, day) => ({
          valid: accumulator.valid + day.valid,
          duplicate: accumulator.duplicate + day.duplicate,
          outOfRange: accumulator.outOfRange + day.outOfRange,
          quarantined: accumulator.quarantined + day.quarantined,
          total: accumulator.total + day.total,
        }),
        { valid: 0, duplicate: 0, outOfRange: 0, quarantined: 0, total: 0 },
      ),
    [days],
  );

  const overallRate = totals.total > 0 ? (totals.valid / totals.total) * 100 : null;
  const apiLimitations =
    devices.some((row) => missingBreakdown(row.counts).length > 0) ||
    devices.some((row) => missingLineage(row));

  const summaryAsOf = summaryQuery.data?.meta.asOf;
  const devicesAsOf = devicesQuery.data?.meta.asOf;
  const isFetching = summaryQuery.isFetching || devicesQuery.isFetching;

  function refresh() {
    void summaryQuery.refetch();
    void devicesQuery.refetch();
  }

  return (
    <M3Shell
      eyebrow="BR4 · Trustworthy data"
      title="Data quality and traceability"
      description="See how many records are valid, duplicated, out of range or quarantined, and trace a device value back to the batch that produced it. These panels are analytical snapshots, not live readings."
      headerAction={
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <select
            className="select-control min-w-0 flex-1 sm:flex-none"
            value={range}
            onChange={(event) => setRange(event.target.value as QualityRange)}
            aria-label="Quality date range"
          >
            {QUALITY_RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" className="button-secondary" onClick={refresh} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      }
    >
      <div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
        <strong>Not live.</strong> Quality comes from the batch layer after each run. Check “Data as
        of” on every panel before acting on a number.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="stat-card">
          <p className="muted text-xs">Records in range</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl">{formatNumber(totals.total, 0)}</p>
          <p className="muted mt-2 text-xs">{days.length} days of batch results</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">Valid rate</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl text-emerald-500">
            {overallRate === null ? "—" : formatPercent(overallRate)}
          </p>
          <p className="muted mt-2 text-xs">{formatNumber(totals.valid, 0)} valid records</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">Duplicates</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl text-blue-500">{formatNumber(totals.duplicate, 0)}</p>
          <p className="muted mt-2 text-xs">Kept once, counted here</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">Quarantined</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl text-rose-500">{formatNumber(totals.quarantined, 0)}</p>
          <p className="muted mt-2 text-xs">Excluded from normal reporting</p>
        </div>
      </div>

      {apiLimitations && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
          The serving API does not expose every per-device breakdown field or lineage record yet.
          Those cells show “chưa có dữ liệu”; totals and the daily chart still come from the batch
          layer.
        </p>
      )}

      <section className="surface-card mt-4 p-5 sm:mt-6">
        <div className="section-heading flex-wrap">
          <div>
            <p className="eyebrow">Daily quality counts</p>
            <h2 className="mt-1 text-lg font-semibold">What arrived, by day</h2>
            <p className="muted mt-1 text-xs">
              {summaryAsOf ? `Data as of ${formatDateTime(summaryAsOf)}` : "Waiting for quality data"} ·
              not live
            </p>
          </div>
          <span className="status-chip resolved">Batch snapshot</span>
        </div>

        <div className="mt-5">
          <QualityStackedBar days={days} />
        </div>

        <p className="muted mt-4 text-xs">
          The chart stacks valid, duplicate, out-of-range and quarantined records. The table
          alternative lists the same numbers; unattended duplicates and quarantined records are never
          presented as normal readings.
        </p>
        {summaryQuery.error instanceof Error && (
          <p role="alert" className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            {summaryQuery.error.message}
          </p>
        )}
      </section>

      <section className="surface-card mt-4 p-5 sm:mt-6">
        <div className="section-heading flex-wrap">
          <div>
            <p className="eyebrow">Per-device quality</p>
            <h2 className="mt-1 text-lg font-semibold">Devices and their records</h2>
            <p className="muted mt-1 text-xs">
              {devicesAsOf ? `Data as of ${formatDateTime(devicesAsOf)}` : "Waiting for device quality"} ·
              not live
            </p>
          </div>
          <span className="status-chip resolved">{devices.length} devices</span>
        </div>

        <div className="mt-5">
          <DeviceQualityTable
            rows={devices}
            onSelect={setSelectedRow}
            isLoading={devicesQuery.isLoading}
            error={devicesQuery.error instanceof Error ? devicesQuery.error.message : null}
            onRetry={() => void devicesQuery.refetch()}
          />
        </div>
      </section>

      <section className="surface-card mt-4 p-5 sm:mt-6">
        <div className="section-heading flex-wrap">
          <div>
            <p className="eyebrow">Traceability</p>
            <h2 className="mt-1 text-lg font-semibold">Where a value came from</h2>
          </div>
        </div>
        <div className="mt-5">
          <TraceView rows={devices} />
        </div>
      </section>

      <section className="surface-card mt-4 p-5 sm:mt-6">
        <div className="section-heading flex-wrap">
          <div>
            <p className="eyebrow">Plain language</p>
            <h2 className="mt-1 text-lg font-semibold">What the quality terms mean</h2>
          </div>
        </div>
        <div className="mt-5">
          <Glossary />
        </div>
      </section>

      {selectedRow && <LineageDrawer row={selectedRow} onClose={() => setSelectedRow(null)} />}
    </M3Shell>
  );
}
