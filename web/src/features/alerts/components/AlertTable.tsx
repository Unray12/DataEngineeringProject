"use client";

import type { Alert } from "@/lib/types";
import {
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS_LABELS,
  ALERT_TYPE_LABELS,
  formatDateTime,
} from "../format";

type AlertTableProps = {
  alerts: Alert[];
  fieldName: (fieldId: string) => string;
  selectedId?: string | null;
  onSelect: (alert: Alert) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

function severityClass(severity: Alert["severity"]): string {
  if (severity === "critical") return "text-rose-600";
  if (severity === "warning") return "text-amber-600";
  return "text-blue-600";
}

export function AlertTable({
  alerts,
  fieldName,
  selectedId,
  onSelect,
  isLoading,
  error,
  onRetry,
}: AlertTableProps) {
  if (isLoading) {
    return <div className="loading-panel">Loading alerts…</div>;
  }

  if (error) {
    return (
      <div className="empty-state">
        <p className="font-semibold">Could not load alerts</p>
        <p className="muted mt-2 text-sm">{error}</p>
        {onRetry && (
          <button type="button" className="button-secondary mt-4" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="empty-state">
        <p className="text-lg font-semibold">No alerts in this view</p>
        <p className="muted mt-2 text-sm">Change the filters or check back after the next micro-batch.</p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table" aria-label="Alerts">
        <thead>
          <tr>
            <th scope="col">Severity</th>
            <th scope="col">Alert</th>
            <th scope="col" className="hidden md:table-cell">Field</th>
            <th scope="col">Status</th>
            <th scope="col" className="hidden lg:table-cell">Opened</th>
            <th scope="col" className="hidden lg:table-cell">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr
              key={alert.id}
              className={selectedId === alert.id ? "bg-emerald-500/5" : undefined}
            >
              <td className={`text-xs font-bold uppercase ${severityClass(alert.severity)}`}>
                {ALERT_SEVERITY_LABELS[alert.severity] ?? alert.severity}
              </td>
              <td className="max-w-[420px] whitespace-normal">
                <button
                  type="button"
                  className="text-left font-medium hover:text-emerald-600"
                  onClick={() => onSelect(alert)}
                >
                  {alert.message}
                </button>
                <p className="muted mt-1 text-xs">
                  {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
                  {alert.deviceId ? ` · ${alert.deviceId}` : ""}
                </p>
                <p className="muted mt-1 text-xs md:hidden">
                  {fieldName(alert.fieldId)} · {formatDateTime(alert.openedAt)}
                </p>
              </td>
              <td className="hidden md:table-cell">{fieldName(alert.fieldId)}</td>
              <td>
                <span className={`status-chip ${alert.status}`}>
                  {ALERT_STATUS_LABELS[alert.status] ?? alert.status}
                </span>
              </td>
              <td className="hidden text-xs lg:table-cell">{formatDateTime(alert.openedAt)}</td>
              <td className="hidden lg:table-cell">
                <button type="button" className="link-button text-xs" onClick={() => onSelect(alert)}>
                  Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
