"use client";

import { useState } from "react";
import type { DeviceQuality } from "@/lib/types";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { formatDateTime } from "@/features/alerts/format";
import { DeviceQualityTable } from "./components/DeviceQualityTable";
import { Glossary } from "./components/Glossary";
import { LineageDrawer } from "./components/LineageDrawer";
import { QualitySummaryCards } from "./components/QualitySummaryCards";
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
        <strong>Not live.</strong> Quality comes from the batch layer. Retrieval times show when
        a snapshot was fetched; the service does not provide its batch refresh time.
      </div>

      <QualitySummaryCards days={summaryQuery.data?.data} loading={summaryQuery.isLoading} failed={summaryQuery.isError} />

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
              {summaryAsOf ? `Snapshot retrieved ${formatDateTime(summaryAsOf)}` : "Waiting for quality data"} ·
              not live
            </p>
          </div>
          <span className="status-chip resolved">Batch snapshot</span>
        </div>

        <div className="mt-5">
          {summaryQuery.data ? <>
            {summaryQuery.isError && <p className="muted mb-3 text-sm">Showing the last successful snapshot. Refresh failed.</p>}
            <QualityStackedBar days={days} />
          </> : summaryQuery.isLoading ? <p role="status">Loading daily quality…</p> : <p className="empty-state">Daily quality data is unavailable.</p>}
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
              {devicesAsOf ? `Snapshot retrieved ${formatDateTime(devicesAsOf)}` : "Waiting for device quality"} ·
              not live
            </p>
          </div>
          <span className="status-chip resolved">{devicesQuery.data ? `${devices.length} devices` : devicesQuery.isLoading ? "Loading devices…" : "Device count unavailable"}</span>
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
          {devicesQuery.data ? <TraceView rows={devices} /> : devicesQuery.isLoading ? <p role="status">Loading traceability…</p> : <p className="empty-state">Traceability is unavailable until device quality loads.</p>}
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
