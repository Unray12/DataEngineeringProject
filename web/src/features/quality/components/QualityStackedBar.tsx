"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDay } from "@/lib/datetime";
import type { QualityDay } from "@/lib/types";
import { QUALITY_COLORS, QUALITY_TERM_LABELS } from "../glossary";

const SERIES = [
  { key: "valid", label: QUALITY_TERM_LABELS.valid, color: QUALITY_COLORS.valid },
  { key: "duplicate", label: QUALITY_TERM_LABELS.duplicate, color: QUALITY_COLORS.duplicate },
  { key: "outOfRange", label: QUALITY_TERM_LABELS.outOfRange, color: QUALITY_COLORS.outOfRange },
  { key: "quarantined", label: QUALITY_TERM_LABELS.quarantined, color: QUALITY_COLORS.quarantined },
] as const;

export function QualityStackedBar({ days }: { days: QualityDay[] }) {
  if (days.length === 0) {
    return (
      <div className="empty-state">
        <p className="font-semibold">No quality records in this range</p>
        <p className="muted mt-2 text-sm">Choose a wider date range or check the batch schedule.</p>
      </div>
    );
  }

  const chartData = days.map((day) => ({ ...day, label: formatDay(day.date, false) }));

  return (
    <div>
      <div
        className="h-64 sm:h-72"
        role="img"
        aria-label="Stacked bar chart of valid, duplicate, out-of-range and quarantined records per day"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={26} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip
              labelFormatter={(label) => `Date ${label}`}
              formatter={(value, name) => [
                Number(value).toLocaleString("en-GB"),
                QUALITY_TERM_LABELS[String(name)] ?? String(name),
              ]}
            />
            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.key}
                stackId="quality"
                fill={series.color}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 flex flex-wrap gap-4" aria-label="Chart legend">
        {SERIES.map((series) => (
          <span key={series.key} className="muted flex items-center gap-2 text-xs">
            <span className="swatch" style={{ background: series.color }} aria-hidden="true" />
            {series.label}
          </span>
        ))}
      </div>

      <details className="mt-4">
        <summary className="action-link cursor-pointer text-sm">View chart as a table</summary>
        <div className="table-scroll mt-3 max-h-72">
          <table className="data-table" aria-label="Daily data quality counts">
            <thead>
              <tr>
                <th scope="col">Date</th>
                {SERIES.map((series) => (
                  <th key={series.key} scope="col">
                    {series.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((day) => (
                <tr key={day.date}>
                  <td>{formatDay(day.date)}</td>
                  <td>{day.valid.toLocaleString("en-GB")}</td>
                  <td>{day.duplicate.toLocaleString("en-GB")}</td>
                  <td>{day.outOfRange.toLocaleString("en-GB")}</td>
                  <td>{day.quarantined.toLocaleString("en-GB")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
