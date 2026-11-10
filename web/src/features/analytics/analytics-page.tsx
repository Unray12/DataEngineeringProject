"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { Dropdown } from "@/components/shared/dropdown";
import { Panel } from "@/features/overview/ui";
import { downloadCsv, toCsv } from "@/features/insights/csv";
import { describeChange, formatNumber } from "@/features/insights/narrative";
import { lastDays } from "@/features/insights/range";
import { METRIC_ICON } from "@/features/insights/types";
import { ComparisonChart, HistoryChart, PeriodChart, WeeklyChart, bucketLabel } from "./charts";
import { alignPeriods, delta, formatDelta, irrigationMessage, rankByTimeInRange, summarize, weeklyAverages } from "./compute";
import { analyticsResponseSchema, granularitySchema, metricSchema, type AnalyticsField, type AnalyticsResponse, type Granularity, type Metric } from "./types";

const METRICS: Array<{ value: Metric; label: string; unit: string }> = [
  { value: "soil_moisture", label: "Soil moisture", unit: "%" },
  { value: "soil_temperature", label: "Soil temperature", unit: "°C" },
  { value: "air_temperature", label: "Air temperature", unit: "°C" },
  { value: "air_humidity", label: "Air humidity", unit: "%" },
  { value: "rainfall", label: "Rainfall", unit: "mm" },
];
const PRESETS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;
const MAX_HOURLY_DAYS = 14;
const DAY_MS = 86_400_000;

const daysIn = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;

async function getJson<T>(url: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(url);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? "Could not load the data.");
  return parse(body);
}

function Kpi({ icon, label, value, hint }: { icon: string; label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <p className="muted flex items-center gap-2 text-sm"><span aria-hidden="true">{icon}</span>{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      <p className="muted mt-1 text-xs">{hint}</p>
    </div>
  );
}

function AnalyticsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const defaults = useMemo(() => lastDays(7), []);
  const metric: Metric = metricSchema.safeParse(params.get("metric")).data ?? "soil_moisture";
  const requested: Granularity = granularitySchema.safeParse(params.get("granularity")).data ?? "daily";
  const from = params.get("from") ?? defaults.from;
  const to = params.get("to") ?? defaults.to;
  const span = daysIn(from, to);
  const granularity: Granularity = requested === "hourly" && span > MAX_HOURLY_DAYS ? "daily" : requested;
  const metricInfo = METRICS.find((item) => item.value === metric) ?? METRICS[0];

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) next.set(key, value);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const fieldsQuery = useQuery({
    queryKey: ["analytics-fields"],
    queryFn: () => getJson("/api/analytics/fields", (body) => (body as { fields: AnalyticsField[] }).fields),
    staleTime: 300_000,
  });
  const fields = fieldsQuery.data ?? [];
  const fieldId = params.get("field") ?? fields[0]?.id ?? "";

  const query = useQuery<AnalyticsResponse>({
    queryKey: ["analytics", fieldId, metric, granularity, from, to],
    queryFn: () =>
      getJson(`/api/analytics?${new URLSearchParams({ fieldId, metric, granularity, from, to })}`, (body) => analyticsResponseSchema.parse(body)),
    enabled: Boolean(fieldId) && from <= to,
    staleTime: 60_000,
  });
  const data = query.data;

  const current = useMemo(() => summarize(data?.indicators ?? []), [data]);
  const previous = useMemo(
    () => summarize((data?.previousHistory ?? []).map((row) => ({ ...row }))),
    [data],
  );
  const aligned = useMemo(() => alignPeriods(data?.history ?? [], data?.previousHistory ?? []), [data]);
  const weekly = useMemo(() => weeklyAverages(data?.history ?? []), [data]);
  const ranked = useMemo(() => rankByTimeInRange(data?.comparison ?? []), [data]);

  const avgDelta = delta(current.avg, previous.avg);
  const fieldName = data?.field.name ?? fields.find((item) => item.id === fieldId)?.name ?? "This field";
  const periodWord = span === 1 ? "today" : `the last ${span} days`;
  const sentence = describeChange(metricInfo.label.toLowerCase(), current.avg, previous.avg, {
    unit: metricInfo.unit,
    period: periodWord,
    previousPeriod: span === 1 ? "the day before" : `the previous ${span} days`,
  });
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `agrimonitor-${metric}-${from}-${to}.csv`,
      toCsv(
        ["bucket", "metric", "min", "max", "average", "readings", "time_in_range_pct", "hours_below_target"],
        data.indicators.map((row) => [row.bucket, row.metric, row.min, row.max, row.avg, row.count, row.time_in_range_pct, row.hours_below_target]),
      ),
    );
  };

  const activePreset = PRESETS.find((preset) => {
    const range = lastDays(preset.days);
    return range.from === from && range.to === to;
  });

  return (
    <M3Shell
      eyebrow="BR5 · BR6 · Historical analytics"
      title="Indicators and history"
      description="Compare fields against their targets, see how conditions changed since the previous period, and decide where to irrigate."
      headerAction={
        <button type="button" className="button-primary" onClick={exportCsv} disabled={!data || data.indicators.length === 0}>
          Export CSV
        </button>
      }
    >
      <section className="surface-card mb-6 p-4 sm:p-5" aria-label="Analytics filters">
        <div className="filter-bar">
          <div className="filter-field min-w-[14rem] flex-1">
            Field
            <Dropdown label="Field" block value={fieldId} options={fields.map((field) => ({ value: field.id, label: `${field.name} · ${field.farmName}` }))} onChange={(value) => set({ field: value })} disabled={fields.length === 0} />
          </div>
          <div className="filter-field min-w-[11rem]">
            Metric
            <Dropdown label="Metric" block value={metric} options={METRICS.map((item) => ({ value: item.value, label: `${METRIC_ICON[item.value]}  ${item.label}` }))} onChange={(value) => set({ metric: value })} />
          </div>
          <div className="filter-field min-w-[9rem]">
            Detail
            <Dropdown label="Detail" block value={granularity} options={[{ value: "daily" as Granularity, label: "Daily" }, { value: "hourly" as Granularity, label: "Hourly" }]} onChange={(value) => set({ granularity: value })} />
          </div>
          <div className="filter-field">
            Period
            <div className="flex gap-1 rounded-xl border border-[var(--line)] p-1" role="group" aria-label="Period presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset.days}
                  type="button"
                  aria-pressed={activePreset?.days === preset.days}
                  onClick={() => set({ ...lastDays(preset.days) })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold normal-case tracking-normal transition ${activePreset?.days === preset.days ? "bg-emerald-500/20 text-emerald-600" : "text-[var(--muted)] hover:bg-emerald-500/10"}`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <label className="filter-field">From<input className="text-input" type="date" value={from} max={to} onChange={(event) => event.target.value && set({ from: event.target.value })} /></label>
          <label className="filter-field">To<input className="text-input" type="date" value={to} min={from} onChange={(event) => event.target.value && set({ to: event.target.value })} /></label>
        </div>
        {requested === "hourly" && granularity === "daily" ? (
          <p className="muted mt-3 text-xs" role="status">Hourly detail is limited to {MAX_HOURLY_DAYS} days, so this period is shown per day.</p>
        ) : null}
      </section>

      {query.error ? (
        <div className="empty-state mb-6" role="alert">
          <p>{(query.error as Error).message}</p>
          <button type="button" className="button-secondary mt-3" onClick={() => void query.refetch()}>Try again</button>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={METRIC_ICON[metric]} label={`Average ${metricInfo.label.toLowerCase()}`} value={current.avg === null ? "–" : `${formatNumber(current.avg)}${metricInfo.unit === "%" ? "%" : ` ${metricInfo.unit}`}`} hint={`${formatDelta(avgDelta, metricInfo.unit)} vs previous period`} />
        <Kpi icon="🎯" label="Time in target range" value={current.timeInRangePct === null ? "–" : `${formatNumber(current.timeInRangePct)}%`} hint={current.timeInRangePct === null ? "No target range for this metric" : "Share of readings inside the crop target"} />
        <Kpi icon="🚿" label="Hours below target" value={metric === "soil_moisture" && current.hoursBelowTarget !== null ? String(current.hoursBelowTarget) : "–"} hint={metric === "soil_moisture" ? "Irrigation indicator for soil moisture" : "Select soil moisture to see it"} />
        <Kpi icon="📈" label="Readings analysed" value={current.readings.toLocaleString("en-GB")} hint={`${current.buckets} ${granularity === "hourly" ? "hours" : "days"} · min ${current.min === null ? "–" : formatNumber(current.min)}, max ${current.max === null ? "–" : formatNumber(current.max)}`} />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title={`${fieldName}: ${metricInfo.label.toLowerCase()} history`} asOf={data?.asOf} live={false} isLoading={query.isLoading} isEmpty={!query.isLoading && (data?.history.length ?? 0) === 0} emptyText="No readings in this period. Pick a longer period or another field.">
            {data ? <HistoryChart rows={data.history} granularity={granularity} unit={metricInfo.unit} target={data.target} label={metricInfo.label} /> : null}
            {data?.target ? <p className="muted mt-2 text-xs"><span className="swatch mr-1" style={{ background: "#3b82f6", opacity: 0.4 }} aria-hidden="true" />Blue band: crop target range {data.target.min}–{data.target.max}{metricInfo.unit}</p> : null}
          </Panel>
        </div>
        <Panel title="What to do" asOf={data?.asOf} live={false} isLoading={query.isLoading}>
          <div className="space-y-4 text-sm">
            <p>
              <b className="eyebrow block">Irrigation</b>
              {metric === "soil_moisture"
                ? irrigationMessage(fieldName, current.hoursBelowTarget, span)
                : "Select soil moisture to see the irrigation indicator for this field."}
            </p>
            <p>
              <b className="eyebrow block">Compared with before</b>
              {sentence}
            </p>
            {data ? (
              <Link className="action-link block" href={`/fields/${data.field.id}`}>Open {data.field.name} →</Link>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Period over period" asOf={data?.asOf} live={false} isLoading={query.isLoading} isEmpty={!query.isLoading && aligned.length === 0} emptyText="Not enough history to compare.">
          <PeriodChart points={aligned} unit={metricInfo.unit} granularity={granularity} label={metricInfo.label} />
          <p className="muted mt-3 flex flex-wrap items-center gap-4 text-xs">
            <span><span className="swatch mr-1" style={{ background: "#10b981" }} aria-hidden="true" />{data ? `${bucketLabel(data.range.from, "daily")} – ${bucketLabel(data.range.to, "daily")}` : "Current"}</span>
            <span><span className="swatch mr-1" style={{ background: "#94a3b8" }} aria-hidden="true" />{data ? `${bucketLabel(data.previousRange.from, "daily")} – ${bucketLabel(data.previousRange.to, "daily")}` : "Previous"}</span>
            <strong>{formatDelta(avgDelta, metricInfo.unit)}</strong>
          </p>
        </Panel>
        <Panel title="Weekly pattern" asOf={data?.asOf} live={false} isLoading={query.isLoading} isEmpty={!query.isLoading && weekly.length === 0} emptyText="Pick a period of at least a week to see weekly averages.">
          <WeeklyChart points={weekly} unit={metricInfo.unit} label={metricInfo.label} />
          <p className="muted mt-2 text-xs">Average per calendar week. Use 90 days to spot seasonal patterns.</p>
        </Panel>
      </div>

      <Panel title="Field comparison" asOf={data?.asOf} live={false} isLoading={query.isLoading} isEmpty={!query.isLoading && ranked.length === 0} emptyText="No field has readings in this period.">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <div className="xl:col-span-2">
            {data ? <ComparisonChart rows={data.comparison} selectedId={data.field.id} unit={metricInfo.unit} label={metricInfo.label} /> : null}
          </div>
          <div className="table-scroll xl:col-span-3">
            <table className="data-table m3-sticky-first">
              <caption className="sr-only">Fields ranked by time in target range</caption>
              <thead>
                <tr><th scope="col">#</th><th scope="col">Field</th><th scope="col">Average</th><th scope="col">In range</th><th scope="col">Hours below target</th></tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr key={row.field_id} className={row.field_id === fieldId ? "bg-emerald-500/5" : undefined}>
                    <td>{row.rank}</td>
                    <td><button type="button" className="link-button text-left" onClick={() => set({ field: row.field_id })}>{row.name}</button><span className="muted block text-xs">{row.farm_name}</span></td>
                    <td>{formatNumber(row.avg)}{metricInfo.unit === "%" ? "%" : ` ${metricInfo.unit}`}</td>
                    <td>{row.time_in_range_pct === null ? "–" : `${formatNumber(row.time_in_range_pct)}%`}</td>
                    <td>{metric === "soil_moisture" && row.hours_below_target !== null ? <span className={`status-chip ${row.hours_below_target > 6 ? "critical" : row.hours_below_target > 0 ? "attention" : "ok"}`}>{row.hours_below_target > 0 ? "▲ " : "✓ "}{row.hours_below_target} h</span> : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>
    </M3Shell>
  );
}

export function AnalyticsPage() {
  return (
    <M3QueryProvider>
      <Suspense fallback={null}>
        <AnalyticsContent />
      </Suspense>
    </M3QueryProvider>
  );
}
