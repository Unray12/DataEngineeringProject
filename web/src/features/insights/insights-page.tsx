"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { useOverview } from "@/features/overview/hooks";
import { Panel } from "@/features/overview/ui";
import { downloadCsv, toCsv } from "./csv";
import { Dropdown } from "./dropdown";
import { useCompare, useSummary } from "./hooks";
import {
  DIRECTION_LABEL,
  attentionSentences,
  attentionTiles,
  buildChanges,
  compareDirection,
  describeComparison,
  formatNumber,
} from "./narrative";
import { lastDays, previousRange } from "./range";
import { METRICS, METRIC_ICON, METRIC_INFO, type CompareRow, type Metric } from "./types";

const PERIODS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
] as const;

function RangeBar({ row, low, high, unit }: { row: CompareRow; low: number; high: number; unit: string }) {
  const span = Math.max(high - low, 0.0001);
  const pct = (value: number) => Math.min(100, Math.max(0, ((value - low) / span) * 100));
  return (
    <div
      role="img"
      aria-label={`Lowest ${formatNumber(row.min)}${unit}, average ${formatNumber(row.avg)}${unit}, highest ${formatNumber(row.max)}${unit}`}
      className="relative h-3 rounded-full bg-[var(--line)]"
    >
      <span
        className="absolute top-0 h-full rounded-full bg-emerald-500/40"
        style={{ left: `${pct(row.min)}%`, width: `${Math.max(2, pct(row.max) - pct(row.min))}%` }}
      />
      <span
        className="absolute top-[-2px] h-4 w-1 rounded bg-emerald-700"
        style={{ left: `calc(${pct(row.avg)}% - 2px)` }}
      />
    </div>
  );
}

function rangeTone(pct: number): string {
  return pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-orange-600" : "text-rose-600";
}

const suffix = (unit: string) => (unit === "%" ? "%" : ` ${unit}`);

function InsightsContent() {
  const [metric, setMetric] = useState<Metric>("soil_moisture");
  const [days, setDays] = useState<number>(7);

  const range = useMemo(() => lastDays(days), [days]);
  const previous = useMemo(() => previousRange(range), [range]);
  const info = METRIC_INFO[metric];
  const periods = { current: `the last ${days} days`, previous: `the previous ${days} days` };

  const overview = useOverview();
  const fields = overview.data?.data.fields;
  const fieldIds = useMemo(() => fields?.map((field) => field.id) ?? [], [fields]);
  const names = useMemo(
    () => Object.fromEntries((fields ?? []).map((field) => [field.id, field.name])),
    [fields],
  );
  const farmOf = useMemo(() => {
    const farms = new Map((overview.data?.data.farms ?? []).map((farm) => [farm.id, farm.name]));
    return Object.fromEntries((fields ?? []).map((field) => [field.id, farms.get(field.farmId) ?? ""]));
  }, [fields, overview.data]);

  const current = useSummary(range, "current");
  const before = useSummary(previous, "previous");
  const compare = useCompare(fieldIds, metric, range);

  const sentences = current.data && before.data ? buildChanges(current.data.data, before.data.data, periods) : [];
  const changes = (current.data?.data ?? []).map((row) => ({
    row,
    before: before.data?.data.find((item) => item.metric === row.metric),
    sentence: sentences.find((item) => item.metric === row.metric)?.text ?? "",
  }));
  const tiles = overview.data ? attentionTiles(overview.data.data) : [];
  const attentionText = overview.data ? attentionSentences(overview.data.data) : [];
  const rows = compare.data?.data ?? [];
  const low = rows.length ? Math.min(...rows.map((row) => row.min)) : 0;
  const high = rows.length ? Math.max(...rows.map((row) => row.max)) : 1;
  const unit = info.unit === "%" ? "%" : ` ${info.unit}`;

  function exportCsv() {
    downloadCsv(
      `field-comparison-${metric}-${range.from}-to-${range.to}.csv`,
      toCsv(
        ["Rank", "Field", "Farm", `Average (${info.unit})`, `Lowest (${info.unit})`, `Highest (${info.unit})`, "Time in range (%)", "Readings"],
        rows.map((row, index) => [
          index + 1,
          names[row.fieldId] ?? row.fieldId,
          farmOf[row.fieldId] ?? "",
          row.avg,
          row.min,
          row.max,
          row.timeInRangePct,
          row.count,
        ]),
      ),
    );
  }

  return (
    <M3Shell
      eyebrow="Insights"
      title="What the data is telling you"
      description="Averages and changes across all fields, with a side-by-side field comparison."
      headerAction={
        <Link href="/" className="button-secondary hover:!border-[var(--accent)] hover:!text-[var(--accent)]">
          ← Overview
        </Link>
      }
    >
      <div className="filter-bar mb-6">
        <div className="filter-field">
          Period
          <Dropdown
            label="Period"
            value={days}
            options={PERIODS.map((item) => ({ value: item.days, label: item.label }))}
            onChange={setDays}
          />
        </div>
      </div>

      <Panel
        title="Needs attention now"
        asOf={overview.data?.asOf}
        isLoading={overview.isLoading}
        error={overview.error}
        onRetry={() => void overview.refetch()}
        isEmpty={false}
      >
        <ul className="sr-only">
          {attentionText.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
        {tiles.length === 0 ? (
          <div aria-hidden="true" className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4">
            <span className="text-2xl">✅</span>
            <div>
              <p className="font-semibold text-emerald-600">All clear</p>
              <p className="muted text-sm">Every field is on target, no alerts are open and all devices are reporting.</p>
            </div>
          </div>
        ) : (
          <ul aria-hidden="true" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            {tiles.map((tile) => {
              const critical = tile.tone === "critical";
              return (
                <li key={tile.key}>
                  <Link
                    href={tile.href}
                    className={`block h-full rounded-2xl border p-4 transition-transform hover:-translate-y-0.5 ${
                      critical ? "border-rose-500/40 bg-rose-500/10" : "border-orange-500/40 bg-orange-500/10"
                    }`}
                  >
                    <p className={`text-3xl font-bold ${critical ? "text-rose-600" : "text-orange-600"}`}>{tile.count}</p>
                    <p className="mt-1 text-sm font-semibold">{tile.label}</p>
                    <p className="muted mt-1 text-xs">{tile.detail}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="mt-6">
        <Panel
          title="What changed"
          live={false}
          asOf={current.data?.meta.asOf}
          isLoading={current.isLoading || before.isLoading}
          error={current.error ?? before.error}
          onRetry={() => {
            void current.refetch();
            void before.refetch();
          }}
          isEmpty={changes.length === 0}
          emptyText="There is no data for this period yet."
        >
          <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
            {changes.map(({ row, before: earlier, sentence }) => {
              const meta = METRIC_INFO[row.metric];
              return (
                <li key={row.metric} className="device-card">
                  <p className="sr-only">{sentence}</p>
                  <div aria-hidden="true">
                    <p className="text-sm font-semibold">
                      {METRIC_ICON[row.metric]} {meta.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold">
                      {formatNumber(row.avg)}
                      <span className="muted ml-1 text-sm font-normal">{meta.unit}</span>
                      <span className="muted ml-2 text-xs font-normal">average</span>
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-[var(--line)] px-2 py-1 font-semibold">
                        {DIRECTION_LABEL[compareDirection(row.avg, earlier?.avg)]}
                      </span>
                      <span className="muted">
                        {earlier
                          ? `Previous ${days} days: ${formatNumber(earlier.avg)}${suffix(meta.unit)}`
                          : `No data for the previous ${days} days`}
                      </span>
                    </p>
                    <p className="muted mt-2 text-xs">
                      Range {formatNumber(row.min)}–{formatNumber(row.max)}
                      {suffix(meta.unit)} · {row.count.toLocaleString("en-US")} readings
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <div className="mt-6">
        <Panel
          title={`Field comparison · ${info.label}`}
          live={false}
          asOf={compare.data?.meta.asOf}
          isLoading={compare.isLoading || overview.isLoading}
          error={compare.error}
          onRetry={() => void compare.refetch()}
          isEmpty={rows.length === 0}
          emptyText="No field has data for this measurement in the selected period."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold">
                Measurement
                <Dropdown
                  label="Measurement"
                  value={metric}
                  options={METRICS.map((item) => ({ value: item, label: METRIC_INFO[item].label, icon: METRIC_ICON[item] }))}
                  onChange={setMetric}
                />
              </div>
              <button type="button" className="button-primary disabled:opacity-50" onClick={exportCsv} disabled={rows.length === 0}>
                Export CSV
              </button>
            </div>
          }
        >
          <p className="mb-4 text-sm">{describeComparison(rows, names, metric)}</p>

          <div className="table-scroll">
            <table className="data-table">
              <caption className="sr-only">
                Fields ranked by average {info.label.toLowerCase()}, {range.from} to {range.to}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Field</th>
                  <th scope="col">Farm</th>
                  <th scope="col">Average</th>
                  <th scope="col">Lowest</th>
                  <th scope="col">Highest</th>
                  <th scope="col">Time in range</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.fieldId}>
                    <td>{index + 1}</td>
                    <th scope="row">
                      <Link href={`/fields/${encodeURIComponent(row.fieldId)}`} className="link-button">
                        {names[row.fieldId] ?? row.fieldId}
                      </Link>
                    </th>
                    <td>{farmOf[row.fieldId] || "—"}</td>
                    <td>
                      {formatNumber(row.avg)}
                      {unit}
                    </td>
                    <td>
                      {formatNumber(row.min)}
                      {unit}
                    </td>
                    <td>
                      {formatNumber(row.max)}
                      {unit}
                    </td>
                    <td className={row.timeInRangePct === null ? undefined : `font-semibold ${rangeTone(row.timeInRangePct)}`}>
                      {row.timeInRangePct === null ? "—" : `${formatNumber(row.timeInRangePct)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mb-3 mt-6 text-sm font-semibold">Each field’s range (bar = lowest to highest, mark = average)</h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <li key={row.fieldId} className="device-card">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <strong className="truncate text-sm">{names[row.fieldId] ?? row.fieldId}</strong>
                  <span className="text-sm">
                    {formatNumber(row.avg)}
                    {unit}
                  </span>
                </div>
                <RangeBar row={row} low={low} high={high} unit={unit} />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </M3Shell>
  );
}

export function InsightsPage() {
  return (
    <M3QueryProvider>
      <InsightsContent />
    </M3QueryProvider>
  );
}
