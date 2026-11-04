"use client";

import { useMemo, useState } from "react";
import type { Alert } from "@/lib/types";
import { isStale } from "@/lib/format";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { AlertDrawer } from "./components/AlertDrawer";
import { AlertFilters } from "./components/AlertFilters";
import { AlertTable } from "./components/AlertTable";
import {
  DEFAULT_ALERT_FILTERS,
  useAlertMutation,
  useAlertReference,
  useAlerts,
  type AlertFilterState,
  type SortOrder,
} from "./hooks";
import type { AlertAction } from "./state";
import { formatDateTime } from "./format";

const SEVERITY_RANK: Record<Alert["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function sortAlerts(alerts: Alert[], order: SortOrder): Alert[] {
  const rows = [...alerts];
  if (order === "oldest") {
    return rows.sort((left, right) => Date.parse(left.openedAt) - Date.parse(right.openedAt));
  }
  if (order === "severity") {
    return rows.sort(
      (left, right) =>
        SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
        Date.parse(right.openedAt) - Date.parse(left.openedAt),
    );
  }
  return rows.sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt));
}

function Stat({
  label,
  value,
  detail,
  color = "text-[var(--ink)]",
}: {
  label: string;
  value: string | number;
  detail: string;
  color?: string;
}) {
  return (
    <div className="stat-card">
      <p className="muted text-xs">{label}</p>
      <p className={`mt-2 text-2xl font-semibold sm:text-3xl ${color}`}>{value}</p>
      <p className="muted mt-2 text-xs">{detail}</p>
    </div>
  );
}

export function AlertsPage() {
  return (
    <M3QueryProvider>
      <AlertsContent />
    </M3QueryProvider>
  );
}

function AlertsContent() {
  const [filters, setFilters] = useState<AlertFilterState>(DEFAULT_ALERT_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const alertsQuery = useAlerts(filters);
  const allAlertsQuery = useAlerts(DEFAULT_ALERT_FILTERS);
  const referenceQuery = useAlertReference();
  const mutation = useAlertMutation();

  const fields = referenceQuery.data?.fields ?? [];
  const devices = referenceQuery.data?.devices ?? [];
  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

  const rows = alertsQuery.data?.data ?? [];
  const visible = useMemo(() => sortAlerts(rows, filters.sort), [rows, filters.sort]);
  const allAlerts = allAlertsQuery.data?.data ?? [];

  const selected = useMemo(
    () => visible.find((alert) => alert.id === selectedId) ?? null,
    [visible, selectedId],
  );

  const openCount = allAlerts.filter((alert) => alert.status === "open").length;
  const acknowledgedCount = allAlerts.filter((alert) => alert.status === "acknowledged").length;
  const criticalOpen = allAlerts.filter(
    (alert) => alert.status === "open" && alert.severity === "critical",
  ).length;
  const resolvedCount = allAlerts.filter((alert) => alert.status === "resolved").length;
  const asOf = alertsQuery.data?.meta.asOf;
  const stale = asOf ? isStale(asOf, 90) : false;

  function fieldName(fieldId: string): string {
    return fieldById.get(fieldId)?.name ?? fieldId;
  }

  async function handleAction(action: AlertAction, input: { by: string; note?: string }) {
    if (!selected) return;
    await mutation.mutateAsync({
      id: selected.id,
      action,
      by: input.by,
      note: input.note,
    });
  }

  return (
    <M3Shell
      eyebrow="BR8 · Early response to risks"
      title="Alerts and response"
      description="See what needs attention, understand the trigger, and record who acknowledged or resolved it. Alert state comes from the operational store; this view refreshes every 30 seconds."
      headerAction={
        <button
          type="button"
          className="button-secondary"
          onClick={() => void alertsQuery.refetch()}
          disabled={alertsQuery.isFetching}
        >
          {alertsQuery.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Open" value={openCount} detail="Awaiting operator review" color="text-rose-500" />
        <Stat
          label="Acknowledged"
          value={acknowledgedCount}
          detail="Owned by an operator"
          color="text-amber-500"
        />
        <Stat
          label="Critical open"
          value={criticalOpen}
          detail="Highest response priority"
          color={criticalOpen > 0 ? "text-rose-500" : "text-emerald-500"}
        />
        <Stat label="Resolved" value={resolvedCount} detail="Closed in the current window" color="text-emerald-500" />
      </div>

      <section className="surface-card mt-4 p-5 sm:mt-6">
        <div className="section-heading flex-wrap">
          <div>
            <p className="eyebrow">Operational alert state</p>
            <h2 className="mt-1 text-lg font-semibold">Alert queue</h2>
            <p className="muted mt-1 text-xs">
              {asOf ? `Data as of ${formatDateTime(asOf)}` : "Waiting for the first payload"} ·{" "}
              {stale ? "stale, older than 90 seconds" : "live, refreshes every 30 seconds"}
            </p>
          </div>
          <span className={`status-chip ${stale ? "attention" : "ok"}`}>
            {stale ? "Stale" : "Live"}
          </span>
        </div>

        <div className="mt-5">
          <AlertFilters
            filters={filters}
            onChange={setFilters}
            farms={referenceQuery.data?.farms ?? []}
            fields={fields}
          />
        </div>

        <p className="muted mt-4 text-xs">
          Showing {visible.length} of {rows.length} matching alerts. Status, severity, type and field
          filters are applied before the table is sorted.
        </p>

        <div className="mt-4">
          <AlertTable
            alerts={visible}
            fieldName={fieldName}
            selectedId={selectedId}
            onSelect={(alert) => setSelectedId(alert.id)}
            isLoading={alertsQuery.isLoading}
            error={alertsQuery.error instanceof Error ? alertsQuery.error.message : alertsQuery.error ? "Unable to load alerts." : null}
            onRetry={() => void alertsQuery.refetch()}
          />
        </div>
      </section>

      <p className="muted mt-4 text-xs">
        Acknowledge or resolve an alert from its detail panel. The responder name is remembered in
        this browser, and every change is validated against the open → acknowledged → resolved matrix.
      </p>

      {selected && (
        <AlertDrawer
          alert={selected}
          field={fieldById.get(selected.fieldId)}
          device={selected.deviceId ? deviceById.get(selected.deviceId) : undefined}
          onClose={() => setSelectedId(null)}
          onAction={handleAction}
          isPending={mutation.isPending}
          error={mutation.error instanceof Error ? mutation.error.message : null}
        />
      )}
    </M3Shell>
  );
}
