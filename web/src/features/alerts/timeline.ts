/**
 * Build the status timeline shown in the alert drawer.
 *
 * Timestamps are optional on purpose: the FastAPI list endpoint does not
 * always return them. A missing timestamp is rendered as "chưa có dữ liệu"
 * rather than hidden or invented.
 */

import type { Alert, AlertStatus } from "@/lib/types";

export type TimelineEntry = {
  key: "opened" | "acknowledged" | "resolved";
  label: string;
  status: AlertStatus;
  at: string | null;
  by?: string;
  note?: string;
  tone: "ok" | "warn" | "danger" | "muted";
};

const TIMELINE_LABELS: Record<TimelineEntry["key"], string> = {
  opened: "Alert opened",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
};

export function timelineFor(alert: Alert): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    {
      key: "opened",
      label: TIMELINE_LABELS.opened,
      status: "open",
      at: alert.openedAt || null,
      tone: alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warn" : "muted",
    },
  ];

  const acknowledged =
    alert.acknowledgedAt !== undefined || alert.status === "acknowledged" || alert.status === "resolved";
  // A direct open -> resolved transition has no acknowledgement event.
  const wasAcknowledged = alert.acknowledgedAt !== undefined || alert.status === "acknowledged";
  if (acknowledged && wasAcknowledged) {
    entries.push({
      key: "acknowledged",
      label: TIMELINE_LABELS.acknowledged,
      status: "acknowledged",
      at: alert.acknowledgedAt ?? null,
      by: alert.acknowledgedBy,
      tone: "warn",
    });
  }

  if (alert.resolvedAt !== undefined || alert.status === "resolved") {
    entries.push({
      key: "resolved",
      label: TIMELINE_LABELS.resolved,
      status: "resolved",
      at: alert.resolvedAt ?? null,
      by: alert.resolvedBy,
      tone: "ok",
    });
  }

  if (alert.note && entries.length > 0) {
    // The note belongs to the action that produced the latest event.
    entries[entries.length - 1] = { ...entries[entries.length - 1], note: alert.note };
  }

  return entries;
}

export function currentEvent(alert: Alert): TimelineEntry {
  const entries = timelineFor(alert);
  return entries[entries.length - 1];
}
