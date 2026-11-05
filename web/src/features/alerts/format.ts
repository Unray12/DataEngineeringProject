const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "chưa có dữ liệu";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "chưa có dữ liệu";
  return DATE_TIME.format(date);
}

export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-GB", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/**
 * True when the snapshot timestamp is older than the freshness budget.
 * The alerts page uses it to warn that the list may be behind. An unparseable
 * timestamp is treated as stale rather than as fresh data.
 */
export function isStale(asOf: string, thresholdSeconds = 90, now = Date.now()): boolean {
  const measured = new Date(asOf).getTime();
  if (Number.isNaN(measured)) return true;
  return now - measured > thresholdSeconds * 1000;
}

export const ALERT_TYPE_LABELS: Record<string, string> = {
  threshold: "Threshold breach",
  rate_of_change: "Rapid change",
  device_outage: "Device outage",
  low_battery: "Low battery",
  poor_signal: "Poor signal",
};

export const ALERT_SEVERITY_LABELS: Record<string, string> = {
  info: "Info",
  warning: "Warning",
  critical: "Critical",
};

export const ALERT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};
