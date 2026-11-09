"use client";
import {
  CartesianGrid,
  LineChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceArea,
} from "recharts";
import type { Series } from "@/types";
import { chartPoints, chartDomain } from "./continuity";
import { formatTime } from "@/features/devices/presentation";

export function GapChart({
  series,
  target,
}: {
  series: Series;
  target?: { min: number; max: number };
}) {
  const points = chartPoints(series);
  const last = [...points].reverse().find((point) => typeof point.value === "number") as
    | { time: number; value: number }
    | undefined;
  if (!series.points.length)
    return <p className="empty-state">No readings in this period.</p>;
  return (
    <>
      <div
        role="img"
        aria-label={`${series.metric.replaceAll("_", " ")} over 24 hours; gaps shaded; suspect and invalid readings excluded`}
        className="mt-4 h-56 w-full min-w-0"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 10, right: 15, left: 0, bottom: 10 }}
          >
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="time"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(value) =>
                formatTime(new Date(Number(value)).toISOString())
                  .split(", ")
                  .pop() ?? ""
              }
              minTickGap={60}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              stroke="var(--line)"
            />
            <YAxis
              width={44}
              domain={chartDomain(series, target)}
              tick={{ fontSize: 11, fill: "var(--muted)" }}
              stroke="var(--line)"
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 12,
                fontSize: 12,
              }}
              labelFormatter={(value) =>
                formatTime(new Date(Number(value)).toISOString())
              }
            />
            {target && (
              <ReferenceArea
                y1={target.min}
                y2={target.max}
                fill="#10b981"
                fillOpacity={0.12}
                ifOverflow="extendDomain"
              />
            )}
            {series.gaps.map((gap) => (
              <ReferenceArea
                key={gap.start}
                x1={Date.parse(gap.start)}
                x2={Date.parse(gap.end)}
                fill="#f97316"
                fillOpacity={0.22}
              />
            ))}
            <Line
              type="linear"
              dataKey="value"
              stroke="#059669"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            {last && (
              <ReferenceDot x={last.time} y={last.value} r={5} fill="#059669" stroke="var(--panel)" strokeWidth={2} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          <span className="mr-1 inline-block h-0.5 w-4 bg-emerald-600 align-middle" />
          Valid readings
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-4 rounded-sm bg-orange-500/30 align-middle" />
          Missing data
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-4 rounded-sm bg-emerald-500/20 align-middle" />
          {target
            ? `Target ${target.min}–${target.max} ${series.unit}`
            : "No target range configured"}
        </span>
        <span>Suspect and invalid values are excluded.</span>
      </p>
      <details className="mt-3">
        <summary className="muted cursor-pointer text-sm">
          Readings table and gap intervals
        </summary>
        {series.gaps.length > 0 && (
          <ul>
            {series.gaps.map((gap) => (
              <li key={gap.start}>
                Gap: {formatTime(gap.start)} – {formatTime(gap.end)}
              </li>
            ))}
          </ul>
        )}
        <div className="table-scroll max-h-72">
          <table
            className="data-table"
            aria-label={`${series.metric.replaceAll("_", " ")} readings`}
          >
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Value ({series.unit})</th>
                <th scope="col">Quality</th>
              </tr>
            </thead>
            <tbody>
              {series.points.map((point, index) => (
                <tr key={`${point.t}-${index}`}>
                  <td>{formatTime(point.t)}</td>
                  <td>
                    {point.value === null
                      ? "Missing"
                      : point.quality === "valid"
                        ? point.value
                        : "Excluded"}
                  </td>
                  <td>{point.quality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
