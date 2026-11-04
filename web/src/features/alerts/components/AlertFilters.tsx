"use client";

import type { AlertSeverity, AlertStatus, AlertType } from "@/lib/types";
import type { AlertFilterState, AlertReference, SortOrder } from "../hooks";
import { ALERT_SEVERITY_LABELS, ALERT_STATUS_LABELS, ALERT_TYPE_LABELS } from "../format";

type AlertFiltersProps = {
  filters: AlertFilterState;
  onChange: (filters: AlertFilterState) => void;
  farms: AlertReference["farms"];
  fields: AlertReference["fields"];
};

const STATUSES: AlertStatus[] = ["open", "acknowledged", "resolved"];
const SEVERITIES: AlertSeverity[] = ["critical", "warning", "info"];
const TYPES: AlertType[] = ["threshold", "rate_of_change", "device_outage", "low_battery", "poor_signal"];
const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  severity: "Severity",
};

export function AlertFilters({ filters, onChange, farms, fields }: AlertFiltersProps) {
  const visibleFields = fields.filter(
    (field) => filters.farmId === "all" || field.farmId === filters.farmId,
  );

  function change(patch: Partial<AlertFilterState>) {
    const next = { ...filters, ...patch };
    if (patch.farmId && patch.farmId !== "all" && next.fieldId !== "all") {
      const field = fields.find((item) => item.id === next.fieldId);
      if (!field || field.farmId !== patch.farmId) next.fieldId = "all";
    }
    onChange(next);
  }

  return (
    <div className="filter-bar" role="group" aria-label="Alert filters">
      <label className="filter-field">
        Status
        <select
          className="select-control"
          value={filters.status}
          onChange={(event) => change({ status: event.target.value as AlertStatus | "all" })}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {ALERT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        Severity
        <select
          className="select-control"
          value={filters.severity}
          onChange={(event) => change({ severity: event.target.value as AlertSeverity | "all" })}
        >
          <option value="all">All severities</option>
          {SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {ALERT_SEVERITY_LABELS[severity]}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        Type
        <select
          className="select-control"
          value={filters.type}
          onChange={(event) => change({ type: event.target.value as AlertType | "all" })}
        >
          <option value="all">All types</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {ALERT_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        Farm
        <select
          className="select-control"
          value={filters.farmId}
          onChange={(event) => change({ farmId: event.target.value })}
        >
          <option value="all">All farms</option>
          {farms.map((farm) => (
            <option key={farm.id} value={farm.id}>
              {farm.name}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        Field
        <select
          className="select-control"
          value={filters.fieldId}
          onChange={(event) => change({ fieldId: event.target.value })}
        >
          <option value="all">All fields</option>
          {visibleFields.map((field) => (
            <option key={field.id} value={field.id}>
              {field.name}
            </option>
          ))}
        </select>
      </label>

      <label className="filter-field">
        Sort
        <select
          className="select-control"
          value={filters.sort}
          onChange={(event) => change({ sort: event.target.value as SortOrder })}
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((order) => (
            <option key={order} value={order}>
              {SORT_LABELS[order]}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className="button-secondary"
        onClick={() =>
          onChange({
            status: "all",
            severity: "all",
            type: "all",
            farmId: "all",
            fieldId: "all",
            sort: filters.sort,
          })
        }
      >
        Clear filters
      </button>
    </div>
  );
}
