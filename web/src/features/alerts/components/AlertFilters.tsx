"use client";

import { Dropdown } from "@/components/shared/dropdown";
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
      <div className="filter-field">
        Status
        <Dropdown
          label="Status"
          value={filters.status}
          options={[
            { value: "all" as AlertStatus | "all", label: "All statuses" },
            ...STATUSES.map((status) => ({ value: status, label: ALERT_STATUS_LABELS[status] })),
          ]}
          onChange={(status) => change({ status })}
        />
      </div>

      <div className="filter-field">
        Severity
        <Dropdown
          label="Severity"
          value={filters.severity}
          options={[
            { value: "all" as AlertSeverity | "all", label: "All severities" },
            ...SEVERITIES.map((severity) => ({ value: severity, label: ALERT_SEVERITY_LABELS[severity] })),
          ]}
          onChange={(severity) => change({ severity })}
        />
      </div>

      <div className="filter-field">
        Type
        <Dropdown
          label="Type"
          value={filters.type}
          options={[
            { value: "all" as AlertType | "all", label: "All types" },
            ...TYPES.map((type) => ({ value: type, label: ALERT_TYPE_LABELS[type] })),
          ]}
          onChange={(type) => change({ type })}
        />
      </div>

      <div className="filter-field">
        Farm
        <Dropdown
          label="Farm"
          value={filters.farmId}
          options={[{ value: "all", label: "All farms" }, ...farms.map((farm) => ({ value: farm.id, label: farm.name }))]}
          onChange={(farmId) => change({ farmId })}
        />
      </div>

      <div className="filter-field">
        Field
        <Dropdown
          label="Field"
          value={filters.fieldId}
          options={[
            { value: "all", label: "All fields" },
            ...visibleFields.map((field) => ({ value: field.id, label: field.name })),
          ]}
          onChange={(fieldId) => change({ fieldId })}
        />
      </div>

      <div className="filter-field">
        Sort
        <Dropdown
          label="Sort"
          value={filters.sort}
          options={(Object.keys(SORT_LABELS) as SortOrder[]).map((order) => ({
            value: order,
            label: SORT_LABELS[order],
          }))}
          onChange={(sort) => change({ sort })}
        />
      </div>

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
