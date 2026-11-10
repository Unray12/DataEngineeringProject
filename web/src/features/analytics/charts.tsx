"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AlignedPoint, WeeklyPoint } from "./compute";
import type { ComparisonRow, HistoryRow, Granularity } from "./types";

const ACCENT = "#10b981";
const MUTED = "#94a3b8";
const GRID = "var(--line)";
const TICK = { fill: "var(--muted)", fontSize: 11 };

export function bucketLabel(bucket: string, granularity: Granularity): string {
  const date = new Date(bucket.includes("T") ? bucket : `${bucket.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  if (granularity === "hourly") {
    return `${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
}

function TooltipBox({ title, rows }: { title: string; rows: Array<[string, string, string?]> }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-bold">{title}</p>
      {rows.map(([label, value, color]) => (
        <p key={label} className="flex items-center gap-2">
          {color ? <span className="swatch" style={{ background: color }} aria-hidden="true" /> : null}
          <span className="muted">{label}</span>
          <b className="ml-auto pl-3">{value}</b>
        </p>
      ))}
    </div>
  );
}

const fmt = (value: number | null | undefined, unit: string) =>
  typeof value === "number" ? `${value.toFixed(1)}${unit === "%" ? "%" : ` ${unit}`}` : "–";

type HistoryProps = { rows: HistoryRow[]; granularity: Granularity; unit: string; target: { min: number; max: number } | null; label: string };

/** Min–max band with the average line; the crop target range is shaded behind it when known. */
export function HistoryChart({ rows, granularity, unit, target, label }: HistoryProps) {
  const data = rows.map((row) => ({ ...row, label: bucketLabel(row.bucket, granularity), band: [row.min, row.max] }));
  return (
    <div className="h-[300px] w-full" role="img" aria-label={`${label} history: average with minimum and maximum per ${granularity === "hourly" ? "hour" : "day"}`}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
          {target ? <ReferenceArea y1={target.min} y2={target.max} fill="#3b82f6" fillOpacity={0.07} stroke="#3b82f6" strokeOpacity={0.25} strokeDasharray="4 4" /> : null}
          <Tooltip
            cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!row) return null;
              return (
                <TooltipBox
                  title={row.label}
                  rows={[
                    ["Average", fmt(row.avg, unit), ACCENT],
                    ["Min", fmt(row.min, unit)],
                    ["Max", fmt(row.max, unit)],
                    ["Readings", String(row.count)],
                  ]}
                />
              );
            }}
          />
          <Area dataKey="band" stroke="none" fill="url(#bandFill)" isAnimationActive={false} />
          <Line dataKey="avg" stroke={ACCENT} strokeWidth={2.5} dot={data.length <= 31} type="monotone" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type PeriodProps = { points: AlignedPoint[]; unit: string; granularity: Granularity; label: string };

/** Current period against the previous one of the same length, overlaid by position (FR6.3). */
export function PeriodChart({ points, unit, granularity, label }: PeriodProps) {
  return (
    <div className="h-[260px] w-full" role="img" aria-label={`${label}: current period compared with the previous period`}>
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as AlignedPoint | undefined) : undefined;
              if (!point) return null;
              return (
                <TooltipBox
                  title={`Position ${point.label}`}
                  rows={[
                    [point.currentBucket ? bucketLabel(point.currentBucket, granularity) : "Current", fmt(point.current, unit), ACCENT],
                    [point.previousBucket ? bucketLabel(point.previousBucket, granularity) : "Previous", fmt(point.previous, unit), MUTED],
                  ]}
                />
              );
            }}
          />
          <Line dataKey="previous" stroke={MUTED} strokeWidth={2} strokeDasharray="6 4" dot={false} type="monotone" connectNulls isAnimationActive={false} />
          <Line dataKey="current" stroke={ACCENT} strokeWidth={2.5} dot={false} type="monotone" connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeeklyChart({ points, unit, label }: { points: WeeklyPoint[]; unit: string; label: string }) {
  const data = points.map((point) => ({ ...point, label: bucketLabel(point.week, "daily") }));
  return (
    <div className="h-[220px] w-full" role="img" aria-label={`${label}: average per week`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} domain={[0, "auto"]} />
          <Tooltip
            cursor={{ fill: "rgba(16,185,129,.08)" }}
            content={({ active, payload }) => {
              const point = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return point ? <TooltipBox title={`Week of ${point.label}`} rows={[["Average", fmt(point.avg, unit), ACCENT], ["Readings", String(point.readings)]]} /> : null;
            }}
          />
          <Bar dataKey="avg" fill={ACCENT} radius={[6, 6, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type CompareProps = { rows: ComparisonRow[]; selectedId: string; unit: string; label: string };

export function ComparisonChart({ rows, selectedId, unit, label }: CompareProps) {
  const data = rows.map((row) => ({ ...row, short: row.name.split(" ")[0] }));
  return (
    <div className="w-full" style={{ height: Math.max(180, rows.length * 34 + 30) }} role="img" aria-label={`${label}: average per field`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={TICK} tickLine={false} axisLine={false} domain={[0, "auto"]} />
          <YAxis type="category" dataKey="short" tick={TICK} tickLine={false} axisLine={false} width={52} />
          <Tooltip
            cursor={{ fill: "rgba(16,185,129,.08)" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              return row ? (
                <TooltipBox
                  title={row.name}
                  rows={[
                    ["Average", fmt(row.avg, unit), ACCENT],
                    ["Min / max", `${fmt(row.min, unit)} / ${fmt(row.max, unit)}`],
                    ["In range", row.time_in_range_pct === null ? "–" : `${row.time_in_range_pct.toFixed(1)}%`],
                  ]}
                />
              ) : null;
            }}
          />
          <Bar dataKey="avg" radius={[0, 6, 6, 0]} isAnimationActive={false}>
            {data.map((row) => (
              <Cell key={row.field_id} fill={row.field_id === selectedId ? ACCENT : "#a7f3d0"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
