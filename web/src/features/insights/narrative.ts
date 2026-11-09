/**
 * Plain-language summaries. Every sentence is built from data by these pure
 * functions, so they can be tested without a browser (BR7).
 */

import { METRICS, METRIC_INFO, type CompareRow, type Metric, type SummaryRow } from "./types";

export function formatNumber(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1);
}

function withUnit(value: number, unit: string): string {
  if (!unit) return formatNumber(value);
  return unit === "%" ? `${formatNumber(value)}%` : `${formatNumber(value)} ${unit}`;
}

function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const SAME_THRESHOLD = 0.05;

const isNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

type ChangeOptions = {
  unit?: string;
  /** Name of the period `current` covers, e.g. "the last 7 days". */
  period?: string;
  /** Name of the period `previous` covers, e.g. "the previous 7 days". */
  previousPeriod?: string;
};

/**
 * Both averages and both periods are named, so nobody has to guess which number is which:
 * "Soil moisture averaged 46.0% over the last 7 days, lower than the 50.0% average over the previous 7 days."
 * The direction is stated but no difference is computed: for metrics already in %, a "% change" would be ambiguous.
 */
export function describeChange(
  label: string,
  current: number | null | undefined,
  previous: number | null | undefined,
  { unit = "", period = "the selected period", previousPeriod = "the previous period" }: ChangeOptions = {},
): string {
  const name = capitalise(label);
  if (!isNumber(current)) return `${name}: no data for ${period}.`;
  const lead = `${name} averaged ${withUnit(current, unit)} over ${period}`;
  if (!isNumber(previous)) return `${lead}; there is no data for ${previousPeriod} to compare with.`;
  const earlier = `the ${withUnit(previous, unit)} average over ${previousPeriod}`;
  if (Math.abs(current - previous) < SAME_THRESHOLD) return `${lead}, the same as ${earlier}.`;
  return `${lead}, ${current > previous ? "higher" : "lower"} than ${earlier}.`;
}

/** One sentence per metric that has data in the current period, tagged with its metric. */
export function buildChanges(
  current: SummaryRow[],
  previous: SummaryRow[],
  periods: { current: string; previous: string },
): Array<{ metric: Metric; text: string }> {
  const previousByMetric = new Map(previous.map((row) => [row.metric, row]));
  return METRICS.flatMap((metric) => {
    const row = current.find((item) => item.metric === metric);
    if (!row) return [];
    const info = METRIC_INFO[metric];
    return [
      {
        metric,
        text: describeChange(info.label.toLowerCase(), row.avg, previousByMetric.get(metric)?.avg, {
          unit: info.unit,
          period: periods.current,
          previousPeriod: periods.previous,
        }),
      },
    ];
  });
}

/** "2nd of 12 fields"; rank 1 is the highest average. */
export function describeRank(rank: number, total: number): string {
  if (total <= 1) return "Only field";
  const teen = rank % 100 >= 11 && rank % 100 <= 13;
  const suffix = teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[rank % 10] ?? "th");
  return `${rank}${suffix} of ${total} fields`;
}

type Direction = "higher" | "lower" | "same" | "none";

/** Which way the average moved; "none" when either period has no data. */
export function compareDirection(current: number | null | undefined, previous: number | null | undefined): Direction {
  if (!isNumber(current) || !isNumber(previous)) return "none";
  if (Math.abs(current - previous) < SAME_THRESHOLD) return "same";
  return current > previous ? "higher" : "lower";
}

export type TargetState = "on_target" | "closer" | "further" | "off_target" | "unknown";

const distance = (value: number, target: { min: number; max: number }) =>
  Math.max(0, target.min - value, value - target.max);

/**
 * Whether a change is good or bad depends on the measurement's healthy range, not on
 * up or down: lower moisture is good when it was above the range and bad when it was below.
 */
export function judgeAgainstTarget(
  current: number | null | undefined,
  previous: number | null | undefined,
  target: { min: number; max: number } | undefined,
): TargetState {
  if (!target || !isNumber(current)) return "unknown";
  const now = distance(current, target);
  if (now === 0) return "on_target";
  if (!isNumber(previous)) return "off_target";
  const before = distance(previous, target);
  if (now < before) return "closer";
  if (now > before) return "further";
  return "off_target";
}

export const DIRECTION_LABEL: Record<Direction, string> = {
  higher: "↑ Higher",
  lower: "↓ Lower",
  same: "→ Same",
  none: "– No comparison",
};

type AttentionTone = "critical" | "warning";
type AttentionTile = {
  key: "fields" | "alerts" | "offline" | "stale";
  count: number;
  label: string;
  detail: string;
  tone: AttentionTone;
  href: string;
};

/** One tile per kind of problem that currently exists; empty when everything is fine. */
export function attentionTiles({ fields, alerts, devices }: AttentionInput): AttentionTile[] {
  const flagged = fields.filter((field) => field.status !== "ok");
  const open = alerts.filter((alert) => alert.status === "open");
  const critical = open.filter((alert) => alert.severity === "critical").length;
  const offline = devices.filter((device) => device.status === "offline").length;
  const stale = devices.filter((device) => device.status === "stale").length;
  const tiles: AttentionTile[] = [];
  if (flagged.length > 0) {
    const shown = flagged.slice(0, 2).map((field) => field.name).join(", ");
    const rest = flagged.length - Math.min(2, flagged.length);
    tiles.push({
      key: "fields",
      count: flagged.length,
      label: flagged.length === 1 ? "Field needs attention" : "Fields need attention",
      detail: rest > 0 ? `${shown} and ${rest} more` : shown,
      tone: flagged.some((field) => field.status === "critical") ? "critical" : "warning",
      href: "/",
    });
  }
  if (open.length > 0) {
    tiles.push({
      key: "alerts",
      count: open.length,
      label: open.length === 1 ? "Open alert" : "Open alerts",
      detail: critical > 0 ? `${critical} critical` : "None critical",
      tone: critical > 0 ? "critical" : "warning",
      href: "/alerts",
    });
  }
  if (offline > 0) {
    tiles.push({
      key: "offline",
      count: offline,
      label: offline === 1 ? "Device offline" : "Devices offline",
      detail: "Not sending data",
      tone: "critical",
      href: "/devices",
    });
  }
  if (stale > 0) {
    tiles.push({
      key: "stale",
      count: stale,
      label: stale === 1 ? "Device quiet" : "Devices quiet",
      detail: "Not reported recently",
      tone: "warning",
      href: "/devices",
    });
  }
  return tiles;
}

/** "Field A has the highest average soil moisture (62.0%); Field B has the lowest (31.5%)." */
export function describeComparison(
  rows: CompareRow[],
  names: Record<string, string>,
  metric: Metric,
): string {
  const info = METRIC_INFO[metric];
  const label = info.label.toLowerCase();
  if (rows.length === 0) return `No field has ${label} data in the selected period.`;
  const nameOf = (row: CompareRow) => names[row.fieldId] ?? row.fieldId;
  const sorted = [...rows].sort((left, right) => right.avg - left.avg);
  const top = sorted[0];
  if (sorted.length === 1) return `Only ${nameOf(top)} has ${label} data (average ${withUnit(top.avg, info.unit)}).`;
  const bottom = sorted[sorted.length - 1];
  return `${nameOf(top)} has the highest average ${label} (${withUnit(top.avg, info.unit)}); ${nameOf(bottom)} has the lowest (${withUnit(bottom.avg, info.unit)}).`;
}

type AttentionInput = {
  fields: Array<{ id: string; name: string; status: "ok" | "attention" | "critical" }>;
  alerts: Array<{ status: "open" | "acknowledged" | "resolved"; severity: "info" | "warning" | "critical" }>;
  devices: Array<{ status: "online" | "stale" | "offline" }>;
};

/** Short, readable list of what needs a person's attention right now. */
export function attentionSentences({ fields, alerts, devices }: AttentionInput): string[] {
  const flagged = fields.filter((field) => field.status !== "ok");
  const open = alerts.filter((alert) => alert.status === "open");
  const critical = open.filter((alert) => alert.severity === "critical").length;
  const offline = devices.filter((device) => device.status === "offline").length;
  const stale = devices.filter((device) => device.status === "stale").length;

  if (flagged.length === 0 && open.length === 0 && offline === 0 && stale === 0) {
    return ["All fields are within their targets, no alerts are open and every device is reporting."];
  }

  const sentences: string[] = [];
  if (flagged.length > 0) {
    const shown = flagged.slice(0, 3).map((field) => field.name);
    const rest = flagged.length - shown.length;
    const list = rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
    sentences.push(`${plural(flagged.length, "field")} need${flagged.length === 1 ? "s" : ""} attention: ${list}.`);
  }
  if (open.length > 0) {
    sentences.push(
      critical > 0
        ? `${plural(open.length, "alert")} ${open.length === 1 ? "is" : "are"} open, ${critical} of them critical.`
        : `${plural(open.length, "alert")} ${open.length === 1 ? "is" : "are"} open.`,
    );
  }
  if (offline > 0) sentences.push(`${plural(offline, "device")} ${offline === 1 ? "is" : "are"} offline.`);
  if (stale > 0) sentences.push(`${plural(stale, "device")} ${stale === 1 ? "has" : "have"} not reported recently.`);
  return sentences;
}
