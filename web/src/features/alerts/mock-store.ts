/**
 * In-memory alert lifecycle for DATA_MODE=mock.
 *
 * Route handlers are bundled separately by Next.js, so the store lives on
 * `globalThis` instead of a module-level array. That keeps `GET /api/alerts`
 * and `PATCH /api/alerts/{id}` looking at the same mutable state in a demo.
 */

import { ApiError } from "@/lib/api/errors";
import { alerts as seedAlerts } from "@/lib/mock/base";
import type { Alert } from "@/lib/types";
import { applyAlertAction, type AlertAction } from "./state";

type GlobalWithAlerts = typeof globalThis & {
  __agrimonitorMockAlerts?: Alert[];
};

function cloneAlert(alert: Alert): Alert {
  return { ...alert };
}

function store(): Alert[] {
  const target = globalThis as GlobalWithAlerts;
  if (!target.__agrimonitorMockAlerts) {
    target.__agrimonitorMockAlerts = seedAlerts.map(cloneAlert);
  }
  return target.__agrimonitorMockAlerts;
}

export function getMockAlerts(): Alert[] {
  return store().map(cloneAlert);
}

export function getMockAlert(id: string): Alert | null {
  const found = store().find((alert) => alert.id === id);
  return found ? cloneAlert(found) : null;
}

export function resetMockAlerts(): void {
  (globalThis as GlobalWithAlerts).__agrimonitorMockAlerts = seedAlerts.map(cloneAlert);
}

export function transitionMockAlert(
  id: string,
  action: AlertAction,
  by: string,
  note?: string,
  now = new Date().toISOString(),
): Alert {
  const rows = store();
  const index = rows.findIndex((alert) => alert.id === id);
  if (index === -1) {
    throw new ApiError(404, `Alert '${id}' was not found.`, "alert_not_found");
  }

  const result = applyAlertAction(rows[index], action, by, note, now);
  if (!result.ok) {
    throw new ApiError(409, result.message, result.code);
  }

  rows[index] = result.alert;
  return cloneAlert(result.alert);
}
