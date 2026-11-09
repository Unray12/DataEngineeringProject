"use client";

import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "@/components/shared/dropdown";
import { M3Shell } from "@/components/m3-shell";
import { formatDateTime, formatDay } from "@/lib/datetime";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsField, AnalyticsResponse, Granularity, Metric } from "@/features/analytics/types";

const metrics: Array<{ value: Metric; label: string; unit: string }> = [
  { value: "soil_moisture", label: "Soil moisture", unit: "%" },
  { value: "soil_temperature", label: "Soil temperature", unit: "°C" },
  { value: "air_temperature", label: "Air temperature", unit: "°C" },
  { value: "air_humidity", label: "Air humidity", unit: "%" },
  { value: "rainfall", label: "Rainfall", unit: "mm" },
];
const formatNumber = (value: number | null | undefined) => value == null || Number.isNaN(value) ? "—" : value.toFixed(1);
const dateValue = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export default function AnalyticsPage() {
  const [fields, setFields] = useState<AnalyticsField[]>([]);
  const [fieldId, setFieldId] = useState("");
  const [metric, setMetric] = useState<Metric>("soil_moisture");
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [from, setFrom] = useState(dateValue(7));
  const [to, setTo] = useState(dateValue(0));
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/analytics/fields").then(async (response) => {
      if (!response.ok) throw new Error("Field reference data is unavailable.");
      return response.json() as Promise<{ fields: AnalyticsField[] }>;
    }).then((body) => { setFields(body.fields); setFieldId((current) => current || body.fields[0]?.id || ""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load fields."));
  }, []);

  useEffect(() => {
    if (!fieldId) return;
    setLoading(true);
    const query = new URLSearchParams({ fieldId, metric, granularity, from, to });
    fetch(`/api/analytics?${query}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Analytical data is unavailable.");
      return response.json() as Promise<AnalyticsResponse>;
    }).then((body) => { setData(body); setError(""); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load analytics.")).finally(() => setLoading(false));
  }, [fieldId, metric, granularity, from, to]);

  const selectedMetric = metrics.find((item) => item.value === metric) ?? metrics[0];
  const selectedField = fields.find((field) => field.id === fieldId);
  const chartData = useMemo(() => data?.history.map((row) => ({ ...row, label: formatDay(row.bucket, false) })) ?? [], [data]);
  const exportCsv = () => {
    if (!data) return;
    const rows = [["bucket", "metric", "min", "max", "average", "count"], ...data.history.map((row) => [row.bucket, row.metric, row.min, row.max, row.avg, row.count])];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agrimonitor-${metric}-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return <M3Shell
    eyebrow="BR5 · BR6"
    title="Historical analytics"
    description="Compare field performance and understand how conditions changed over time."
    headerAction={<button className="button-primary disabled:opacity-50" onClick={exportCsv} disabled={!data}>Export CSV</button>}
  >
    <div>
    <section className="analytics-filters" aria-label="Analytics filters">
      <div className="grid gap-[.35rem] text-xs font-bold text-[#647481]">Field<Dropdown label="Field" block value={fieldId} options={fields.map((field) => ({ value: field.id, label: `${field.name} · ${field.farmName}` }))} onChange={setFieldId} /></div>
      <div className="grid gap-[.35rem] text-xs font-bold text-[#647481]">Metric<Dropdown label="Metric" block value={metric} options={metrics.map((item) => ({ value: item.value, label: item.label }))} onChange={setMetric} /></div>
      <div className="grid gap-[.35rem] text-xs font-bold text-[#647481]">Granularity<Dropdown label="Granularity" block value={granularity} options={[{ value: "daily" as Granularity, label: "Daily" }, { value: "hourly" as Granularity, label: "Hourly" }]} onChange={setGranularity} /></div>
      <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
    </section>
    {error ? <section className="analytics-state" role="alert"><strong>Could not load analytics</strong><p>{error}</p><button className="analytics-button" onClick={() => setFieldId((value) => value)}>Retry</button></section> : loading ? <section className="analytics-state" aria-live="polite">Loading analytical data…</section> : data ? <><p className="analytics-asof">Data as of {formatDateTime(data.asOf)} · {data.source === "trino" ? "Gold analytical data" : "Preview data"}</p><section className="analytics-grid"><article className="analytics-card analytics-chart"><div className="analytics-card-heading"><div><h2>{selectedMetric.label} trend</h2><p>{selectedField?.name} · {granularity} aggregates · {selectedMetric.unit}</p></div></div><div className="chart-wrap" role="img" aria-label={`${selectedMetric.label} historical average chart`}><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#d8e2df" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis unit={selectedMetric.unit} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatNumber(Number(value))} /><Bar dataKey="avg" fill="#059669" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div><table className="sr-only"><caption>Historical {selectedMetric.label} values</caption><thead><tr><th>Date</th><th>Minimum</th><th>Average</th><th>Maximum</th></tr></thead><tbody>{data.history.map((row) => <tr key={row.bucket}><td>{formatDay(row.bucket)}</td><td>{formatNumber(row.min)}</td><td>{formatNumber(row.avg)}</td><td>{formatNumber(row.max)}</td></tr>)}</tbody></table></article><article className="analytics-card"><h2>Field indicators</h2><p className="analytics-muted">Time in target range and irrigation pressure.</p><div className="indicator-list">{data.indicators.slice(0, 6).map((row) => <div className="indicator-row" key={`${row.bucket}-${row.metric}`}><span>{row.bucket}</span><strong>{formatNumber(row.time_in_range_pct)}%</strong><small>in range · {formatNumber(row.hours_below_target)}h below target</small></div>)}</div></article></section><section className="analytics-card comparison-card"><div className="analytics-card-heading"><div><h2>Field comparison</h2><p className="analytics-muted">Ranked by average {selectedMetric.label.toLowerCase()} for the selected period.</p></div></div><div className="comparison-list">{data.comparison.map((row, index) => <div className="comparison-row" key={row.field_id}><span className="rank">{index + 1}</span><div className="comparison-name"><strong>{fields.find((field) => field.id === row.field_id)?.name ?? row.field_id}</strong><div className="comparison-track"><span style={{ width: `${Math.min(100, Math.max(4, row.avg))}%` }} /></div></div><strong>{formatNumber(row.avg)} {selectedMetric.unit}</strong></div>)}</div></section></> : <section className="analytics-state">Select a field to view analytics.</section>}
    </div>
  </M3Shell>;
}
