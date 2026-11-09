"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Dropdown } from "@/components/shared/dropdown";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import type { Field } from "@/lib/types";
import { useOverview } from "./hooks";
import {
  ALL,
  applyScope,
  countDevices,
  deviceSentence,
  devicesNeedingAttention,
  topOpenAlerts,
  type OverviewData,
} from "./summary";
import { DeviceChip, Panel, StatusChip } from "./ui";

function useScope() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const farmId = params.get("farm") ?? ALL;
  const fieldId = params.get("field") ?? ALL;

  function update(next: { farm?: string; field?: string }) {
    const search = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (!value || value === ALL) search.delete(key);
      else search.set(key, value);
    }
    router.replace(search.size ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  return { farmId, fieldId, update };
}

function Stat({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: string }) {
  return (
    <div className="stat-card">
      <p className="muted text-xs">
        <span aria-hidden="true">{icon}</span> {label}
      </p>
      <p className="mt-2 text-2xl font-semibold sm:text-3xl">{value}</p>
      <p className="muted mt-2 text-xs">{detail}</p>
    </div>
  );
}

function reading(value: number, unit: string): string {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}${unit}` : "—";
}

function FieldRow({ field }: { field: Field }) {
  return (
    <li>
      <Link href={`/fields/${encodeURIComponent(field.id)}`} className="field-row flex-wrap gap-3">
        <span className="min-w-0 flex-1">
          <strong className="block">{field.name}</strong>
          <span className="muted text-xs">
            {field.crop} · {field.growthStage}
          </span>
        </span>
        <span className="muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>Soil moisture {reading(field.moisture, "%")}</span>
          <span>Air {reading(field.temperature, " °C")}</span>
          <span>Humidity {reading(field.humidity, "%")}</span>
        </span>
        <StatusChip status={field.status} />
      </Link>
    </li>
  );
}

function Hierarchy({ data }: { data: OverviewData }) {
  return (
    <div className="space-y-4">
      {data.farms.map((farm) => {
        const fields = data.fields.filter((field) => field.farmId === farm.id);
        return (
          <div key={farm.id} className="rounded-2xl border border-[var(--line)] bg-[var(--bg)]/40 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">{farm.name}</h3>
                <p className="muted text-xs">
                  {farm.region} · {fields.length} {fields.length === 1 ? "field" : "fields"}
                </p>
              </div>
              <StatusChip status={farm.status} />
            </div>
            {fields.length === 0 ? (
              <p className="muted text-sm">No fields match the current filter.</p>
            ) : (
              <ul className="space-y-1">
                {fields.map((field) => (
                  <FieldRow key={field.id} field={field} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Attention({ data }: { data: OverviewData }) {
  const names = useMemo(() => new Map(data.fields.map((field) => [field.id, field.name])), [data.fields]);
  const alerts = topOpenAlerts(data.alerts);
  const devices = devicesNeedingAttention(data.devices);
  const fieldName = (id: string) => names.get(id) ?? id;
  const now = Date.now();

  if (alerts.length === 0 && devices.length === 0) {
    return <p className="text-sm">Nothing needs attention right now.</p>;
  }

  return (
    <div className="space-y-4">
      {alerts.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Open alerts</h3>
          <ul className="space-y-2">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <Link href={`/alerts?alert=${encodeURIComponent(alert.id)}`} className="alert-row">
                <span className={`severity-icon ${alert.severity}`} aria-hidden="true">
                  {alert.severity === "critical" ? "!" : alert.severity === "warning" ? "▲" : "i"}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <strong className="block">
                    {alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1)} · {fieldName(alert.fieldId)}
                  </strong>
                  <span className="muted">{alert.message}</span>
                </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/alerts" className="action-link mt-2 inline-block">
            See all alerts
          </Link>
        </div>
      ) : null}
      {devices.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Devices not reporting</h3>
          <ul className="space-y-2">
            {devices.map((device) => (
              <li key={device.id} className="device-card flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{deviceSentence(device, fieldName(device.fieldId), now)}</span>
                <DeviceChip status={device.status} />
              </li>
            ))}
          </ul>
          <Link href="/devices" className="action-link mt-2 inline-block">
            See all devices
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function OverviewContent() {
  const query = useOverview();
  const scope = useScope();
  const full = query.data?.data;

  const scoped = useMemo(
    () => (full ? applyScope(full, { farmId: scope.farmId, fieldId: scope.fieldId }) : null),
    [full, scope.farmId, scope.fieldId],
  );
  const fieldOptions = useMemo(
    () => (full ? full.fields.filter((field) => scope.farmId === ALL || field.farmId === scope.farmId) : []),
    [full, scope.farmId],
  );

  const devices = scoped ? countDevices(scoped.devices) : null;
  const openAlerts = scoped ? scoped.alerts.filter((alert) => alert.status === "open") : [];
  const criticalAlerts = openAlerts.filter((alert) => alert.severity === "critical").length;
  const panel = {
    asOf: query.data?.asOf,
    isLoading: query.isLoading,
    error: query.error,
    onRetry: () => void query.refetch(),
  };

  return (
    <M3Shell
      eyebrow="Overview"
      title="All farms at a glance"
      description="Every farm, field and sensor in one place, with what needs attention first."
      headerAction={
        <Link href="/insights" className="button-secondary hover:!border-[var(--accent)] hover:!text-[var(--accent)]">
          Insights
        </Link>
      }
    >
      <div className="filter-bar mb-6">
        <div className="filter-field">
          Farm
          <Dropdown
            label="Farm"
            value={scope.farmId}
            options={[{ value: ALL, label: "All farms" }, ...(full?.farms.map((farm) => ({ value: farm.id, label: farm.name })) ?? [])]}
            onChange={(farm) => scope.update({ farm, field: ALL })}
            disabled={!full}
          />
        </div>
        <div className="filter-field">
          Field
          <Dropdown
            label="Field"
            value={scope.fieldId}
            options={[{ value: ALL, label: "All fields" }, ...fieldOptions.map((field) => ({ value: field.id, label: field.name }))]}
            onChange={(field) => scope.update({ field })}
            disabled={!full}
          />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon="🏡" label="Farms" value={scoped ? scoped.farms.length : "—"} detail="In the current view" />
        <Stat icon="🌾" label="Fields" value={scoped ? scoped.fields.length : "—"} detail="Being monitored" />
        <Stat
          icon="📡"
          label="Devices online"
          value={devices ? `${devices.online} / ${devices.total}` : "—"}
          detail={devices ? `${devices.stale} stale · ${devices.offline} offline` : "Loading"}
        />
        <Stat
          icon="🔔"
          label="Open alerts"
          value={scoped ? openAlerts.length : "—"}
          detail={scoped ? `${criticalAlerts} critical` : "Loading"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title="Farms and fields"
          {...panel}
          isEmpty={!!scoped && scoped.fields.length === 0}
          emptyText="No fields match the current filter."
        >
          {scoped ? <Hierarchy data={scoped} /> : null}
        </Panel>
        <Panel title="What needs attention" {...panel}>
          {scoped ? <Attention data={scoped} /> : null}
        </Panel>
      </div>
    </M3Shell>
  );
}

export function OverviewPage() {
  return (
    <M3QueryProvider>
      <Suspense fallback={null}>
        <OverviewContent />
      </Suspense>
    </M3QueryProvider>
  );
}
