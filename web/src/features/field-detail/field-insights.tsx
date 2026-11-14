"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Dropdown } from "@/components/shared/dropdown";
import { useFieldInsights } from "@/features/insights/hooks";
import {
  DIRECTION_LABEL,
  compareDirection,
  describeRank,
  formatNumber,
  judgeAgainstTarget,
  type TargetState,
} from "@/features/insights/narrative";
import { lastDays, previousRange } from "@/features/insights/range";
import { Tooltip } from "@/components/shared/tooltip";
import { METRICS, METRIC_ICON, METRIC_INFO } from "@/features/insights/types";
import { Panel } from "@/features/overview/ui";
import type { Field } from "@/lib/types";

const PERIODS = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

// Colour follows the healthy range, not the direction: green when the average is on
// target or moving toward it, orange when moving away, no judgement without a range.
const STATE: Record<TargetState, { text: string; tone: string }> = {
  on_target: { text: "On target", tone: "bg-emerald-500/10 text-emerald-600" },
  closer: { text: "Closer to target", tone: "bg-emerald-500/10 text-emerald-600" },
  further: { text: "Further from target", tone: "bg-orange-500/10 text-orange-600" },
  off_target: { text: "Off target", tone: "bg-orange-500/10 text-orange-600" },
  unknown: { text: "", tone: "" },
};

const suffix = (unit: string) => (unit === "%" ? "%" : ` ${unit}`);

type Props = { fieldId: string; fieldIds: string[]; targets?: Field["targets"] };

/** Per-measurement cards: average, change vs the previous period, target status and rank. */
export function FieldInsights({ fieldId, fieldIds, targets }: Props) {
  const [days, setDays] = useState(7);
  const range = useMemo(() => lastDays(days), [days]);
  const previous = useMemo(() => previousRange(range), [range]);
  const insights = useFieldInsights(fieldIds, range, previous);

  const cards = METRICS.flatMap((metric) => {
    const now = insights.rows[metric].current.find((row) => row.fieldId === fieldId);
    if (!now) return [];
    const before = insights.rows[metric].previous.find((row) => row.fieldId === fieldId);
    const ranked = [...insights.rows[metric].current].sort((left, right) => right.avg - left.avg);
    const rank = ranked.findIndex((row) => row.fieldId === fieldId) + 1;
    return [
      {
        metric,
        now,
        before,
        direction: compareDirection(now.avg, before?.avg),
        state: judgeAgainstTarget(now.avg, before?.avg, targets?.[metric]),
        rank: describeRank(rank, ranked.length),
      },
    ];
  });

  return (
    <Panel
      title="Insights"
      live={false}
      asOf={insights.asOf}
      isLoading={insights.isLoading}
      error={insights.error}
      onRetry={insights.refetch}
      isEmpty={cards.length === 0}
      emptyText="There is no data for this field in the selected period."
      action={<Dropdown label="Period" value={days} options={PERIODS} onChange={setDays} />}
    >
      <ul className="grid gap-3">
        {cards.map(({ metric, now, before, direction, state, rank }) => {
          const info = METRIC_INFO[metric];
          const target = targets?.[metric];
          const judged = STATE[state];
          return (
            <li key={metric} className="device-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  <span aria-hidden="true">{METRIC_ICON[metric]}</span> {info.label}
                </p>
                <Tooltip text="Ranked by average. 1st is the highest." align="end">
                  <span className="muted rounded-full border border-[var(--line)] px-2 py-0.5 text-xs">{rank}</span>
                </Tooltip>
              </div>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <p className="text-2xl font-semibold">
                  {formatNumber(now.avg)}
                  <span className="muted ml-1 text-sm font-normal">{info.unit}</span>
                  <span className="muted ml-2 text-xs font-normal">average, last {days} days</span>
                </p>
                <p className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-[var(--line)] px-2 py-1 font-semibold">{DIRECTION_LABEL[direction]}</span>
                  <span className="muted">
                    {before
                      ? `Previous ${days} days: ${formatNumber(before.avg)}${suffix(info.unit)}`
                      : `No data for the previous ${days} days`}
                  </span>
                </p>
              </div>
              {target && judged.text ? (
                <p className="mt-2 text-xs">
                  <Tooltip text={`Healthy range: ${target.min}–${target.max}${suffix(info.unit)}`}>
                    <span className={`rounded-full px-2 py-1 font-semibold ${judged.tone}`}>{judged.text}</span>
                  </Tooltip>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Link href="/insights" className="action-link mt-4 inline-block">
        Compare all fields →
      </Link>
    </Panel>
  );
}
