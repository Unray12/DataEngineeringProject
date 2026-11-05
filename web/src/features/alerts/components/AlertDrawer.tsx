"use client";

import { useEffect, useState } from "react";
import type { Alert, Metric } from "@/lib/types";
import { canAct, type AlertAction } from "../state";
import { timelineFor } from "../timeline";
import {
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS_LABELS,
  ALERT_TYPE_LABELS,
  formatDateTime,
  formatNumber,
} from "../format";
import type { AlertReference } from "../hooks";
import { AlertTimeline } from "./AlertTimeline";
import { ActionDialog } from "./ActionDialog";

const METRIC_LABELS: Record<Metric, string> = {
  soil_moisture: "Soil moisture",
  soil_temperature: "Soil temperature",
  air_temperature: "Air temperature",
  air_humidity: "Air humidity",
  rainfall: "Rainfall",
};

const METRIC_UNITS: Record<Metric, string> = {
  soil_moisture: "%",
  soil_temperature: "°C",
  air_temperature: "°C",
  air_humidity: "%",
  rainfall: "mm",
};

type AlertDrawerProps = {
  alert: Alert;
  field?: AlertReference["fields"][number];
  device?: AlertReference["devices"][number];
  onClose: () => void;
  onAction: (action: AlertAction, input: { by: string; note?: string }) => Promise<void>;
  isPending: boolean;
  error?: string | null;
};

export function AlertDrawer({
  alert,
  field,
  device,
  onClose,
  onAction,
  isPending,
  error,
}: AlertDrawerProps) {
  const [pendingAction, setPendingAction] = useState<AlertAction | null>(null);
  const actions = canAct(alert.status);
  const timeline = timelineFor(alert);
  const hasMissingTimeline = timeline.some((entry) => entry.at === null);
  const unit = alert.metric ? METRIC_UNITS[alert.metric] : "";
  const target = alert.metric ? field?.targets?.[alert.metric] : undefined;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (pendingAction) setPendingAction(null);
        else onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pendingAction]);

  async function submit(input: { by: string; note?: string }) {
    if (!pendingAction) return;
    try {
      await onAction(pendingAction, input);
      setPendingAction(null);
    } catch {
      // The mutation error is rendered in both the dialog and the drawer.
    }
  }

  return (
    <div
      className="drawer-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-drawer-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Alert detail</p>
            <h2 id="alert-drawer-title" className="mt-1 text-xl font-semibold">
              {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`status-chip ${alert.status}`}>
                {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
              </span>
              <span className="muted text-xs font-semibold uppercase">
                {ALERT_SEVERITY_LABELS[alert.severity] ?? alert.severity}
              </span>
            </div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close alert detail">
            ×
          </button>
        </div>

        <p className="mt-4 text-sm leading-6">{alert.message}</p>

        <section className="mt-6 rounded-xl border border-[var(--line)] p-4">
          <h3 className="text-sm font-semibold">Trigger explanation</h3>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="muted text-xs">Observed</dt>
              <dd className="font-medium">
                {alert.observedValue === undefined
                  ? "chưa có dữ liệu"
                  : `${formatNumber(alert.observedValue)}${unit ? ` ${unit}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="muted text-xs">Threshold</dt>
              <dd className="font-medium">
                {alert.thresholdValue === undefined
                  ? "chưa có dữ liệu"
                  : `${formatNumber(alert.thresholdValue)}${unit ? ` ${unit}` : ""}`}
              </dd>
            </div>
            <div>
              <dt className="muted text-xs">Metric</dt>
              <dd className="font-medium">{alert.metric ? METRIC_LABELS[alert.metric] : "chưa có dữ liệu"}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Field</dt>
              <dd className="font-medium">{field?.name ?? alert.fieldId}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Device</dt>
              <dd className="font-medium">{device?.name ?? alert.deviceId ?? "chưa có dữ liệu"}</dd>
            </div>
            <div>
              <dt className="muted text-xs">Opened</dt>
              <dd className="font-medium">{formatDateTime(alert.openedAt)}</dd>
            </div>
          </dl>
          {target && alert.metric && (
            <p className="muted mt-3 text-xs">
              Crop target: {formatNumber(target.min)}–{formatNumber(target.max)} {unit}
            </p>
          )}
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">Status timeline</h3>
            <span className="muted text-xs">Local time</span>
          </div>
          <div className="mt-4">
            <AlertTimeline entries={timeline} />
          </div>
          {hasMissingTimeline && (
            <p className="muted mt-3 text-xs">
              Some lifecycle timestamps are not provided by the serving API: chưa có dữ liệu.
            </p>
          )}
        </section>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--line)] pt-4">
          {actions.acknowledge && (
            <button
              type="button"
              className="button-secondary"
              onClick={() => setPendingAction("acknowledge")}
              disabled={isPending}
            >
              Acknowledge
            </button>
          )}
          {actions.resolve && (
            <button
              type="button"
              className="button-primary"
              onClick={() => setPendingAction("resolve")}
              disabled={isPending}
            >
              Resolve
            </button>
          )}
          {!actions.acknowledge && !actions.resolve && (
            <p className="muted text-sm">This alert is resolved; no further action is possible.</p>
          )}
        </div>
        <p className="muted mt-3 text-xs">
          Actions are recorded with your name and are sent to the alert state store.
        </p>
      </aside>

      {pendingAction && (
        <ActionDialog
          alert={alert}
          action={pendingAction}
          isPending={isPending}
          error={error}
          onCancel={() => setPendingAction(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}
