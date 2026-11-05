/**
 * Pure alert state machine (BR8, FR8.4).
 *
 * The matrix mirrors `ALLOWED_TRANSITIONS` in `src/streaming/alerts.py`:
 *   open -> acknowledged | resolved
 *   acknowledged -> resolved
 *   resolved -> (nothing)
 *
 * The route handler and the optimistic UI both call these helpers, so an
 * invalid transition is impossible to express in one place and rejected in
 * the other.
 */

import type { Alert, AlertStatus } from "@/lib/types";

export type AlertAction = "acknowledge" | "resolve";

export type InvalidTransition = {
  ok: false;
  code: "invalid_transition";
  message: string;
  from: AlertStatus;
  action: AlertAction;
  allowed: AlertStatus[];
};

export type TransitionResult = { ok: true; status: AlertStatus } | InvalidTransition;
export type ApplyResult = { ok: true; alert: Alert } | InvalidTransition;

export const ALLOWED_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ["acknowledged", "resolved"],
  acknowledged: ["resolved"],
  resolved: [],
};

export function targetStatus(action: AlertAction): AlertStatus {
  return action === "acknowledge" ? "acknowledged" : "resolved";
}

export function transition(current: AlertStatus, action: AlertAction): TransitionResult {
  const target = targetStatus(action);
  const allowed = ALLOWED_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Cannot ${action} an alert in status '${current}'.`,
      from: current,
      action,
      allowed: [...allowed],
    };
  }
  return { ok: true, status: target };
}

export function canAct(status: AlertStatus): { acknowledge: boolean; resolve: boolean } {
  return {
    acknowledge: ALLOWED_TRANSITIONS[status].includes("acknowledged"),
    resolve: ALLOWED_TRANSITIONS[status].includes("resolved"),
  };
}

/**
 * Apply a manual action. Timestamps and the responder are supplied by the
 * caller so the function stays pure and testable.
 */
export function applyAlertAction(
  alert: Alert,
  action: AlertAction,
  by: string,
  note?: string,
  now = new Date().toISOString(),
): ApplyResult {
  const result = transition(alert.status, action);
  if (!result.ok) return result;

  const trimmedNote = note?.trim();
  const updated: Alert = {
    ...alert,
    status: result.status,
    ...(action === "acknowledge"
      ? { acknowledgedAt: now, acknowledgedBy: by }
      : { resolvedAt: now, resolvedBy: by }),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
  return { ok: true, alert: updated };
}

export type DeviceStatus = "online" | "stale" | "offline";

/**
 * Device-outage alerts resolve themselves once the device reports again.
 * Matches the backend rule: only an `open` alert is auto-resolved; an
 * acknowledged alert stays with the operator.
 */
export function autoResolveOutage(
  alert: Alert,
  deviceStatus: DeviceStatus,
  now = new Date().toISOString(),
): Alert {
  if (alert.type !== "device_outage" || alert.status !== "open" || deviceStatus !== "online") {
    return alert;
  }
  return {
    ...alert,
    status: "resolved",
    resolvedAt: now,
    resolvedBy: "system",
    note: alert.note ?? "Auto-resolved when the device reported again.",
  };
}
