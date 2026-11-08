"use client";
import {
  LineChart,
  Line,
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
            />
            <YAxis width={48} domain={chartDomain(series, target)} />
            <Tooltip
              labelFormatter={(value) =>
                formatTime(new Date(Number(value)).toISOString())
              }
            />
            {target && (
              <ReferenceArea
                y1={target.min}
                y2={target.max}
                fill="#15803d"
                fillOpacity={0.12}
                ifOverflow="extendDomain"
              />
            )}
            {series.gaps.map((gap) => (
              <ReferenceArea
                key={gap.start}
                x1={Date.parse(gap.start)}
                x2={Date.parse(gap.end)}
                fill="#9a6700"
                fillOpacity={0.3}
              />
            ))}
            <Line
              type="linear"
              dataKey="value"
              stroke="#0072b2"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="muted text-sm">
        Blue line: valid readings. Shaded intervals: missing readings. Suspect
        and invalid values are excluded.{" "}
        {target
          ? `Target band: ${target.min}–${target.max} ${series.unit}.`
          : "No target range configured."}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer">
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
