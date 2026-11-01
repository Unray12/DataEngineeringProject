"use client";

import { useEffect, useMemo, useState } from "react";
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
  const chartData = useMemo(() => data?.history.map((row) => ({ ...row, label: row.bucket })) ?? [], [data]);
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

  return <main className="analytics-page">
    <header className="analytics-header"><div><p className="analytics-eyebrow">M4 · BR5, BR6</p><h1>Historical analytics</h1><p>Compare field performance and understand how conditions changed over time.</p></div><button className="analytics-button" onClick={exportCsv} disabled={!data}>Export CSV</button></header>
    <section className="analytics-filters" aria-label="Analytics filters">
      <label>Field<select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>{fields.map((field) => <option key={field.id} value={field.id}>{field.name} · {field.farmName}</option>)}</select></label>
      <label>Metric<select value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>{metrics.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Granularity<select value={granularity} onChange={(event) => setGranularity(event.target.value as Granularity)}><option value="daily">Daily</option><option value="hourly">Hourly</option></select></label>
      <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
    </section>
    {error ? <section className="analytics-state" role="alert"><strong>Could not load analytics</strong><p>{error}</p><button className="analytics-button" onClick={() => setFieldId((value) => value)}>Retry</button></section> : loading ? <section className="analytics-state" aria-live="polite">Loading analytical data…</section> : data ? <><p className="analytics-asof">Data as of {new Date(data.asOf).toLocaleString()} · {data.source === "trino" ? "Gold analytical data" : "Preview data"}</p><section className="analytics-grid"><article className="analytics-card analytics-chart"><div className="analytics-card-heading"><div><h2>{selectedMetric.label} trend</h2><p>{selectedField?.name} · {granularity} aggregates · {selectedMetric.unit}</p></div></div><div className="chart-wrap" role="img" aria-label={`${selectedMetric.label} historical average chart`}><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#d8e2df" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis unit={selectedMetric.unit} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="avg" fill="#059669" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div><table className="sr-only"><caption>Historical {selectedMetric.label} values</caption><thead><tr><th>Date</th><th>Minimum</th><th>Average</th><th>Maximum</th></tr></thead><tbody>{data.history.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td>{row.min}</td><td>{row.avg}</td><td>{row.max}</td></tr>)}</tbody></table></article><article className="analytics-card"><h2>Field indicators</h2><p className="analytics-muted">Time in target range and irrigation pressure.</p><div className="indicator-list">{data.indicators.slice(0, 6).map((row) => <div className="indicator-row" key={`${row.bucket}-${row.metric}`}><span>{row.bucket}</span><strong>{formatNumber(row.time_in_range_pct)}%</strong><small>in range · {formatNumber(row.hours_below_target)}h below target</small></div>)}</div></article></section><section className="analytics-card comparison-card"><div className="analytics-card-heading"><div><h2>Field comparison</h2><p className="analytics-muted">Ranked by average {selectedMetric.label.toLowerCase()} for the selected period.</p></div></div><div className="comparison-list">{data.comparison.map((row, index) => <div className="comparison-row" key={row.field_id}><span className="rank">{index + 1}</span><div className="comparison-name"><strong>{fields.find((field) => field.id === row.field_id)?.name ?? row.field_id}</strong><div className="comparison-track"><span style={{ width: `${Math.min(100, Math.max(4, row.avg))}%` }} /></div></div><strong>{formatNumber(row.avg)} {selectedMetric.unit}</strong></div>)}</div></section></> : <section className="analytics-state">Select a field to view analytics.</section>}
  </main>;
}
