/** Pure helpers for the overview and field pages (BR1). */

import type { Alert, Device, Farm, Field } from "@/lib/types";

const STALE_AFTER_MS = 90_000;

export type OverviewData = { farms: Farm[]; fields: Field[]; devices: Device[]; alerts: Alert[] };
type Scope = { farmId: string; fieldId: string };
export const ALL = "all";

/** Live data older than 90 s is shown with a warning. */
export function isStale(asOf: string, now: number = Date.now(), thresholdMs: number = STALE_AFTER_MS): boolean {
  const time = Date.parse(asOf);
  return !Number.isFinite(time) || now - time > thresholdMs;
}

export function countDevices(devices: Device[]) {
  return {
    total: devices.length,
    online: devices.filter((device) => device.status === "online").length,
    stale: devices.filter((device) => device.status === "stale").length,
    offline: devices.filter((device) => device.status === "offline").length,
  };
}

/** Restrict every list to the selected farm and field. A field outside the farm selects nothing. */
export function applyScope(data: OverviewData, scope: Scope): OverviewData {
  const farms = data.farms.filter((farm) => scope.farmId === ALL || farm.id === scope.farmId);
  const farmIds = new Set(farms.map((farm) => farm.id));
  const fields = data.fields.filter(
    (field) => farmIds.has(field.farmId) && (scope.fieldId === ALL || field.id === scope.fieldId),
  );
  const fieldIds = new Set(fields.map((field) => field.id));
  return {
    farms,
    fields,
    devices: data.devices.filter((device) => fieldIds.has(device.fieldId)),
    alerts: data.alerts.filter((alert) => fieldIds.has(alert.fieldId)),
  };
}

const SEVERITY_RANK: Record<Alert["severity"], number> = { critical: 0, warning: 1, info: 2 };

export function topOpenAlerts(alerts: Alert[], limit = 5): Alert[] {
  return alerts
    .filter((alert) => alert.status === "open")
    .sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        Date.parse(right.openedAt) - Date.parse(left.openedAt),
    )
    .slice(0, limit);
}

/** Offline devices first, then stale ones, most recently seen first within each group. */
export function devicesNeedingAttention(devices: Device[], limit = 5): Device[] {
  const rank = { offline: 0, stale: 1, online: 2 } as const;
  return devices
    .filter((device) => device.status !== "online")
    .sort(
      (left, right) =>
        rank[left.status] - rank[right.status] || Date.parse(right.lastSeen) - Date.parse(left.lastSeen),
    )
    .slice(0, limit);
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "unknown";
  const minutes = Math.max(0, Math.round((now - time) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function deviceSentence(device: Device, fieldName: string, now: number = Date.now()): string {
  const since = timeAgo(device.lastSeen, now);
  return device.status === "offline"
    ? `Sensor ${device.name} in ${fieldName} is offline (last seen ${since}).`
    : `Sensor ${device.name} in ${fieldName} has not reported recently (last seen ${since}).`;
}

export const STATUS_TEXT = { ok: "OK", attention: "Needs attention", critical: "Critical" } as const;
export const STATUS_ICON = { ok: "✓", attention: "▲", critical: "●" } as const;
export const DEVICE_TEXT = { online: "Online", stale: "Stale", offline: "Offline" } as const;
export const DEVICE_ICON = { online: "✓", stale: "▲", offline: "✕" } as const;
