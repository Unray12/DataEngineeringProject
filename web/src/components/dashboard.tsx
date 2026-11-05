"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Alert, Device, Farm, Field, Metric, Series } from "@/lib/types";
import { useSidebarCollapse } from "./use-sidebar-collapse";

type DashboardData = { farms: Farm[]; fields: Field[]; devices: Device[]; alerts: Alert[]; asOf: string };
const DataContext = createContext<DashboardData>({ farms: [], fields: [], devices: [], alerts: [], asOf: "" });
const nav = [
  { href: "/", label: "Overview", icon: "⌂" },
  { href: "/live", label: "Live monitor", icon: "◉" },
  { href: "/alerts", label: "Alerts", icon: "!" },
  { href: "/analytics", label: "Analytics", icon: "↗" },
  { href: "/quality", label: "Data quality", icon: "✓" },
  { href: "/devices", label: "Devices", icon: "▣" },
];
const metricLabels: Record<Metric, string> = {
  soil_moisture: "Soil moisture",
  soil_temperature: "Soil temperature",
  air_temperature: "Air temperature",
  air_humidity: "Air humidity",
  rainfall: "Rainfall",
};
const unitFor = (metric: Metric) => metric === "soil_moisture" || metric === "air_humidity" ? "%" : metric === "rainfall" ? "mm" : "°C";
const fmt = (date: string | null | undefined) => date ? new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (date: string | null | undefined) => date ? new Date(date).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const statusColor = (status: string) => status === "critical" || status === "offline" ? "text-rose-500" : status === "attention" || status === "stale" ? "text-amber-500" : "text-emerald-500";
const statusDot = (status: string) => status === "critical" || status === "offline" ? "bg-rose-400" : status === "attention" || status === "stale" ? "bg-amber-400" : "bg-emerald-400";
function useData() { return useContext(DataContext); }

function Header({ view, dark, setDark }: { view: string; dark: boolean; setDark: (value: boolean) => void }) {
  const title = view === "overview" ? "Good morning, Linh" : nav.find((item) => item.href === `/${view}`)?.label ?? "Field detail";
  return <header className="mb-6 flex flex-wrap items-start justify-between gap-4 sm:mb-8"><div className="min-w-0 flex-1"><p className="eyebrow mb-2">Field intelligence · live workspace</p><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1><p className="muted mt-2 text-sm">{view === "overview" ? "A calm, current view of conditions across your farms." : "Conditions, continuity and action in one place."}</p></div><div className="flex flex-wrap items-center justify-end gap-2"><button aria-label="Toggle theme" onClick={() => setDark(!dark)} className="icon-button">{dark ? "☼" : "☾"}</button><div className="profile-chip"><span>LN</span><b className="hidden sm:inline">Linh Nguyen</b></div></div></header>;
}

function Sidebar({ view, collapsed, onToggle }: { view: string; collapsed: boolean; onToggle: () => void }) {
  const { alerts } = useData();
  const openCount = alerts.filter((alert) => alert.status !== "resolved").length;
  return (
    <aside id="app-sidebar" className={`sidebar ${collapsed ? "is-collapsed" : ""} fixed bottom-0 left-0 top-0 z-10 flex w-64 flex-col border-r border-[var(--line)] bg-[var(--panel)] px-5 py-7`} aria-label="Workspace">
      <div className="sidebar-head mb-12">
        <Link href="/" className="sidebar-brand flex items-center gap-3" aria-label="AgriMonitor home">
          <div className="brand-mark">✦</div>
          <div className="sidebar-label"><strong className="text-lg">AgriMonitor</strong><p className="muted text-xs">Farm intelligence</p></div>
        </Link>
        <button type="button" className="sidebar-toggle" onClick={onToggle} aria-expanded={!collapsed} aria-controls="app-sidebar" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}><span aria-hidden="true">{collapsed ? "»" : "«"}</span></button>
      </div>
      <p className="eyebrow sidebar-label mb-3 px-3">Workspace</p>
      <nav className="space-y-1" aria-label="Main navigation">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} aria-current={view === item.href.slice(1) || (view === "overview" && item.href === "/") ? "page" : undefined} className={`nav-item ${view === item.href.slice(1) || (view === "overview" && item.href === "/") ? "nav-item-active" : ""}`}>
            <span className="w-5 text-center text-lg" aria-hidden="true">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
            {item.label === "Alerts" && openCount > 0 && <span className="badge-danger ml-auto">{openCount}</span>}
          </Link>
        ))}
      </nav>
      <div className="system-card mt-auto" title={collapsed ? "Pipeline healthy" : undefined}>
        <div className="flex items-center gap-2"><span className="status-pulse shrink-0 bg-emerald-400" /><p className="sidebar-label text-sm font-semibold">Pipeline healthy</p></div>
        <p className="sidebar-label muted mt-2 text-xs">Live readings are flowing into the workspace.</p>
        <div className="progress-track sidebar-label"><div className="progress-value w-[96%]" /></div>
      </div>
    </aside>
  );
}

function FarmFilter({ selected, setSelected }: { selected: string; setSelected: (id: string) => void }) {
  const { farms, asOf } = useData();
  return <div className="mb-7 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm"><span className="muted">Viewing</span><select value={selected} onChange={(event) => setSelected(event.target.value)} className="select-control"><option value="all">All farms</option>{farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></div><span className="muted text-xs">Live data as of {fmtDate(asOf)} · refreshes every 30 sec</span></div>;
}

function Stat({ label, value, detail, color = "text-[var(--ink)]" }: { label: string; value: string | number; detail: string; color?: string }) {
  return <div className="stat-card"><p className="muted text-xs">{label}</p><p className={`mt-2 text-2xl font-semibold sm:text-3xl ${color}`}>{value}</p><p className="muted mt-2 text-xs">{detail}</p></div>;
}

function Overview({ farmId }: { farmId: string }) {
  const { farms, fields, devices, alerts } = useData();
  const visible = fields.filter((field) => farmId === "all" || field.farmId === farmId);
  const visibleIds = new Set(visible.map((field) => field.id));
  const scopedDevices = devices.filter((device) => visibleIds.has(device.fieldId));
  const open = alerts.filter((alert) => alert.status !== "resolved" && (farmId === "all" || visibleIds.has(alert.fieldId)));
  return <><div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"><Stat label="Farms monitored" value={farmId === "all" ? farms.length : 1} detail={`${farms.length} regions connected`} /><Stat label="Fields" value={visible.length} detail="Latest conditions available" /><Stat label="Devices online" value={`${scopedDevices.filter((device) => device.status === "online").length}/${scopedDevices.length}`} detail="From Cassandra device status" color="text-emerald-500" /><Stat label="Open alerts" value={open.length} detail="Requires operator review" color="text-rose-500" /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]"><section className="surface-card p-5"><div className="section-heading"><div><p className="eyebrow">Field overview</p><h2 className="mt-1 text-lg font-semibold">Conditions by field</h2></div><Link href="/live" className="action-link">Open live view →</Link></div><div className="space-y-2">{visible.map((field) => <FieldRow key={field.id} field={field} />)}</div></section><Attention alerts={open} /></div></>;
}

function FieldRow({ field }: { field: Field }) {
  return <Link href={`/fields/${field.id}`} className="field-row"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${statusDot(field.status)}`} /><div><p className="text-sm font-semibold">{field.name}</p><p className="muted text-xs">{field.crop} · {field.areaHa} ha</p></div></div><div className="hidden items-center gap-6 text-right text-sm sm:flex"><div><p className="muted text-[11px]">Moisture</p><strong>{field.moisture ? `${field.moisture.toFixed(1)}%` : "—"}</strong></div><div><p className="muted text-[11px]">Temperature</p><strong>{field.temperature ? `${field.temperature.toFixed(1)}°C` : "—"}</strong></div><span className={`status-chip ${field.status}`}>{field.status}</span></div></Link>;
}

function Attention({ alerts }: { alerts: Alert[] }) {
  return <section className="surface-card p-5"><p className="eyebrow">Needs attention</p><h2 className="mt-1 text-lg font-semibold">Priority actions</h2><div className="mt-5 space-y-4">{alerts.length === 0 ? <p className="muted text-sm">No active alerts in this scope.</p> : alerts.slice(0, 4).map((alert) => <div key={alert.id} className="flex gap-3"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${alert.severity === "critical" ? "bg-rose-500" : "bg-amber-400"}`} /><div><p className="text-sm font-medium">{alert.message}</p><p className="muted mt-1 text-xs">{fmt(alert.openedAt)} · {alert.status}</p></div></div>)}</div><Link href="/alerts" className="action-link mt-6 block border-t border-[var(--line)] pt-4">Review all alerts →</Link></section>;
}

function Live({ farmId, setFarmId }: { farmId: string; setFarmId: (id: string) => void }) {
  const { fields, devices } = useData();
  const [fieldId, setFieldId] = useState("");
  const [metric, setMetric] = useState<Metric>("soil_moisture");
  const [chart, setChart] = useState<Series | null>(null);
  const [error, setError] = useState("");
  const visibleFields = fields.filter((field) => farmId === "all" || field.farmId === farmId);
  const field = visibleFields.find((item) => item.id === fieldId) ?? visibleFields[0];
  useEffect(() => { if (field && field.id !== fieldId) setFieldId(field.id); }, [field, fieldId]);
  useEffect(() => {
    if (!field) return;
    let active = true;
    const load = async () => { try { const response = await fetch(`/api/series?metric=${metric}&fieldId=${field.id}`, { cache: "no-store" }); if (!response.ok) throw new Error("Unable to load live history"); const body = await response.json() as { data: Series }; if (active) { setChart(body.data); setError(""); } } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Unable to load live history"); } };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [field, metric]);
  if (!field) return <EmptyState title="No fields available" detail="The API has not returned any fields yet." />;
  const data = (chart?.points ?? []).map((point) => ({ ...point, time: fmt(point.t) }));
  const fieldDevices = devices.filter((device) => device.fieldId === field.id);
  return <><FarmFilter selected={farmId} setSelected={setFarmId} /><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Near real-time · Cassandra</p><h2 className="mt-1 text-xl font-semibold">{field.name}</h2><p className="muted mt-1 text-sm">Current conditions and the last 24 hours.</p></div><div className="flex flex-wrap gap-2"><select value={field.id} onChange={(event) => setFieldId(event.target.value)} className="select-control">{visibleFields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={metric} onChange={(event) => setMetric(event.target.value as Metric)} className="select-control">{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"><Stat label="Soil moisture" value={`${field.moisture.toFixed(1)}%`} detail="Latest reading" color={field.moisture < 30 ? "text-amber-500" : "text-emerald-500"} /><Stat label="Air temperature" value={`${field.temperature.toFixed(1)}°C`} detail="Latest reading" color="text-emerald-500" /><Stat label="Air humidity" value={`${field.humidity.toFixed(1)}%`} detail="Latest reading" color="text-emerald-500" /></div><section className="surface-card mt-6 p-5"><div className="section-heading"><div><h2 className="font-semibold">{metricLabels[metric]} · last 24 hours</h2><p className="muted mt-1 text-xs">Live Cassandra series · gaps remain visible</p></div><span className="status-chip ok">Live · 30 sec</span></div>{error ? <ErrorState detail={error} onRetry={() => setChart(null)} /> : <div className="h-72"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><defs><linearGradient id="live-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={.35} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" /><XAxis dataKey="time" tick={{ fontSize: 10 }} minTickGap={30} /><YAxis unit={unitFor(metric)} tick={{ fontSize: 10 }} /><Tooltip /><Area type="monotone" dataKey="value" stroke="#10b981" fill="url(#live-fill)" connectNulls={false} /></AreaChart></ResponsiveContainer></div>}</section><DevicePanel devices={fieldDevices} /></>;
}

function DevicePanel({ devices }: { devices: Device[] }) {
  return <section className="surface-card mt-6 p-5"><div className="section-heading"><h2 className="font-semibold">Device health</h2><Link href="/devices" className="action-link">All devices →</Link></div><div className="grid gap-3 sm:grid-cols-3">{devices.map((device) => <div key={device.id} className="device-card"><div className="flex items-center justify-between"><span className={`status-dot ${statusDot(device.status)}`} /><strong className="text-sm">{device.name}</strong><span className={`ml-auto text-xs font-semibold ${statusColor(device.status)}`}>{device.status}</span></div><p className="muted mt-3 text-xs">Last seen {fmtDate(device.lastSeen)}</p><div className="mt-3 flex justify-between text-xs"><span>Battery {device.batteryPct}%</span><span>Signal {device.rssi}</span></div></div>)}</div></section>;
}

function AlertsView() {
  const { alerts, fields } = useData();
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState(alerts);
  useEffect(() => setItems(alerts), [alerts]);
  const update = async (id: string, action: "acknowledge" | "resolve") => { const previous = items; setItems(items.map((alert) => alert.id === id ? { ...alert, status: action === "resolve" ? "resolved" : "acknowledged" } : alert)); try { const response = await fetch(`/api/alerts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); if (!response.ok) throw new Error("Update failed"); } catch { setItems(previous); } };
  const visible = filter === "all" ? items : items.filter((alert) => alert.status === filter);
  return <section className="surface-card p-5"><div className="section-heading"><div><p className="eyebrow">Cassandra alert state</p><h2 className="mt-1 text-lg font-semibold">Alerts and response</h2></div><select value={filter} onChange={(event) => setFilter(event.target.value)} className="select-control"><option value="all">All statuses</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option></select></div><div className="mt-5 space-y-3">{visible.map((alert) => <div key={alert.id} className="alert-row"><div className={`severity-icon ${alert.severity}`}>!</div><div className="min-w-0 flex-1"><p className="font-medium">{alert.message}</p><p className="muted mt-1 text-xs">{fields.find((field) => field.id === alert.fieldId)?.name ?? alert.fieldId} · {fmtDate(alert.openedAt)}</p></div><span className={`status-chip ${alert.status}`}>{alert.status}</span>{alert.status === "open" && <button className="button-secondary" onClick={() => void update(alert.id, "acknowledge")}>Acknowledge</button>}{alert.status === "acknowledged" && <button className="button-primary" onClick={() => void update(alert.id, "resolve")}>Resolve</button>}</div>)}</div>{visible.length === 0 && <EmptyState title="No alerts in this view" detail="This filter is clear." />}</section>;
}

function Analytics() {
  const { fields } = useData();
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? "");
  const [rows, setRows] = useState<Array<{ bucket: string; min: number; max: number; avg: number }>>([]);
  useEffect(() => { if (fields[0] && !fields.some((field) => field.id === fieldId)) setFieldId(fields[0].id); }, [fields, fieldId]);
  useEffect(() => { if (!fieldId) return; fetch(`/api/analytics?fieldId=${fieldId}`).then((response) => response.json()).then((body: { data: { rows: Array<{ bucket: string; min: number; max: number; avg: number }> } }) => setRows(body.data.rows)).catch(() => setRows([])); }, [fieldId]);
  return <section className="surface-card p-5"><div className="section-heading"><div><p className="eyebrow">Intraday / daily · Trino + Iceberg</p><h2 className="mt-1 text-lg font-semibold">Historical field performance</h2></div><select value={fieldId} onChange={(event) => setFieldId(event.target.value)} className="select-control">{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></div><p className="muted mt-2 text-sm">Gold daily aggregates; this view is not live.</p>{rows.length === 0 ? <div className="empty-state mt-5"><p className="font-semibold">No gold rows for this field yet</p><p className="muted mt-2 text-sm">The daily aggregate job has not written rows for this field. Check the batch schedule or pick another field.</p></div> : <div className="mt-5 h-72"><ResponsiveContainer width="100%" height="100%"><BarChart data={rows}><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" /><XAxis dataKey="bucket" tick={{ fontSize: 10 }} /><YAxis unit="%" tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="avg" fill="#10b981" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>}</section>;
}

function Quality() {
  const { devices } = useData();
  const [summary, setSummary] = useState<Array<{ date: string; valid: number; duplicate: number; out_of_range: number; quarantined: number }>>([]);
  useEffect(() => { fetch("/api/quality").then((response) => response.json()).then((body: { data: { summary: typeof summary; devices: Array<{ device_id: string; total: number; valid: number; flagged: number }> } }) => setSummary(body.data.summary)).catch(() => setSummary([])); }, []);
  return <><section className="surface-card p-5"><p className="eyebrow">Trino + Iceberg quality_daily</p><h2 className="mt-1 text-lg font-semibold">Trust and traceability</h2><p className="muted mt-2 text-sm">Valid, duplicate, out-of-range and quarantined records from the batch layer.</p><div className="mt-5 h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary}><CartesianGrid stroke="var(--line)" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="valid" stackId="a" fill="#10b981" /><Bar dataKey="out_of_range" stackId="a" fill="#f59e0b" /><Bar dataKey="quarantined" stackId="a" fill="#f43f5e" /></BarChart></ResponsiveContainer></div></section><section className="surface-card mt-6 p-5"><h2 className="font-semibold">Device quality</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{devices.map((device) => <div key={device.id} className="device-card flex items-center justify-between"><span><strong className="text-sm">{device.name}</strong><span className="muted ml-2 text-xs">gap count {device.gapCount24h}</span></span><span className={`text-sm font-semibold ${statusColor(device.status)}`}>{device.status}</span></div>)}</div></section></>;
}

function Devices() { const { devices } = useData(); return <section className="surface-card overflow-hidden p-5"><div className="section-heading"><div><p className="eyebrow">Operational continuity</p><h2 className="mt-1 text-lg font-semibold">All devices</h2></div><span className="status-chip ok">{devices.length} registered</span></div><div className="mt-5 overflow-x-auto"><table className="data-table m3-sticky-first"><thead><tr><th>Device</th><th>Status</th><th>Last seen</th><th>Battery</th><th>Signal</th><th>Gaps / 24h</th></tr></thead><tbody>{devices.map((device) => <tr key={device.id}><td className="font-medium">{device.name}</td><td className={statusColor(device.status)}>{device.status}</td><td>{fmtDate(device.lastSeen)}</td><td>{device.batteryPct}%</td><td>{device.rssi}</td><td>{device.gapCount24h}</td></tr>)}</tbody></table></div></section>; }

function FieldDetail({ fieldId }: { fieldId: string }) { const { fields, devices, alerts } = useData(); const field = fields.find((item) => item.id === fieldId); if (!field) return <EmptyState title="Field not found" detail="The requested field is not present in the live reference data." />; return <><section className="hero-card"><div><p className="eyebrow">Field detail</p><h2 className="mt-2 text-2xl font-semibold">{field.name}</h2><p className="muted mt-2">{field.crop} · {field.areaHa} ha · {field.growthStage}</p></div><div className={`status-chip ${field.status}`}>{field.status}</div></section><div className="mt-6 grid gap-6 md:grid-cols-2"><DevicePanel devices={devices.filter((device) => device.fieldId === field.id)} /><Attention alerts={alerts.filter((alert) => alert.fieldId === field.id && alert.status !== "resolved")} /></div></>; }
function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><p className="text-lg font-semibold">{title}</p><p className="muted mt-2 text-sm">{detail}</p></div>; }
function ErrorState({ detail, onRetry }: { detail: string; onRetry: () => void }) { return <div className="empty-state"><p className="font-semibold">Could not load live data</p><p className="muted mt-2 text-sm">{detail}</p><button className="button-secondary mt-4" onClick={onRetry}>Retry</button></div>; }

export default function Dashboard() {
  const [dark, setDark] = useState(() => typeof window !== "undefined" && window.localStorage.getItem("agrimonitor-theme") === "dark");
  const [farmId, setFarmId] = useState("all");
  const [view, setView] = useState("overview");
  const [fieldId, setFieldId] = useState("");
  const [data, setData] = useState<DashboardData>({ farms: [], fields: [], devices: [], alerts: [], asOf: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { collapsed, toggle: toggleSidebar } = useSidebarCollapse();
  useEffect(() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    setView(parts[0] || "overview");
    if (parts[0] === "fields" && parts[1]) { setView("fields"); setFieldId(parts[1]); }
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); window.localStorage.setItem("agrimonitor-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { let active = true; const load = async () => { try { const response = await fetch("/api/dashboard", { cache: "no-store" }); if (!response.ok) throw new Error("The monitoring API is unavailable."); const body = await response.json() as { farms: { data: Farm[]; meta: { asOf: string } }; fields: { data: Field[] }; devices: { data: Device[] }; alerts: { data: Alert[] } }; if (active) { setData({ farms: body.farms.data, fields: body.fields.data, devices: body.devices.data, alerts: body.alerts.data, asOf: body.farms.meta.asOf }); setLoading(false); setError(""); } } catch (reason) { if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : "Unable to load monitoring data."); } } }; void load(); const timer = window.setInterval(load, 30_000); return () => { active = false; window.clearInterval(timer); }; }, []);
  const content = useMemo(() => view === "live" ? <Live farmId={farmId} setFarmId={setFarmId} /> : view === "alerts" ? <AlertsView /> : view === "analytics" ? <Analytics /> : view === "quality" ? <Quality /> : view === "devices" ? <Devices /> : view === "fields" ? <FieldDetail fieldId={fieldId} /> : <Overview farmId={farmId} />, [view, farmId, fieldId, data]);
  return (
    <DataContext.Provider value={data}>
      <a href="#app-content" className="skip-link">Skip to content</a>
      <Sidebar view={view} collapsed={collapsed} onToggle={toggleSidebar} />
      <main id="app-content" tabIndex={-1} className={`main ${collapsed ? "is-collapsed" : ""} min-h-screen pl-72 p-8`}>
        <div className="mx-auto max-w-[1400px]">
          <Header view={view} dark={dark} setDark={setDark} />
          {error ? <ErrorState detail={error} onRetry={() => window.location.reload()} /> : loading ? <div className="loading-panel">Loading live farm data…</div> : <>{view === "overview" && <FarmFilter selected={farmId} setSelected={setFarmId} />}{content}</>}
        </div>
      </main>
      <nav className="mobile-nav fixed bottom-0 left-0 right-0 z-20 justify-around border-t border-[var(--line)] bg-[var(--panel)] p-2" aria-label="Mobile navigation">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} className={`mobile-nav-item ${view === item.href.slice(1) || (view === "overview" && item.href === "/") ? "text-emerald-500" : ""}`}>
            <span className="block text-lg" aria-hidden="true">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </DataContext.Provider>
  );
}
