"use client";

import Link from "next/link";
import { M3QueryProvider, M3Shell } from "@/components/m3-shell";
import { FieldInsights } from "./field-insights";
import { METRIC_ICON, METRIC_INFO } from "@/features/insights/types";
import { useOverview } from "@/features/overview/hooks";
import { timeAgo } from "@/features/overview/summary";
import { DeviceChip, Panel, StatusChip, formatDateTime } from "@/features/overview/ui";
import type { Field } from "@/lib/types";

function reading(value: number, unit: string): string {
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(1)}${unit}` : "—";
}

function Targets({ field }: { field: Field }) {
  const entries = Object.entries(field.targets ?? {});
  if (entries.length === 0) {
    return <p className="muted text-sm">No target ranges are configured for this crop.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption className="sr-only">Target ranges for {field.name}</caption>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Healthy range</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([metric, range]) => {
            const info = METRIC_INFO[metric as keyof typeof METRIC_INFO];
            const unit = info?.unit ?? "";
            return (
              <tr key={metric}>
                <th scope="row" className="!text-sm !font-medium !normal-case !tracking-normal !text-[var(--ink)]">
                  {info?.label ?? metric}
                </th>
                <td>
                  {range.min}–{range.max} {unit}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldDetailContent({ fieldId }: { fieldId: string }) {
  const query = useOverview();
  const data = query.data?.data;
  const field = data?.fields.find((item) => item.id === fieldId);
  const farm = data?.farms.find((item) => item.id === field?.farmId);
  const devices = data?.devices.filter((device) => device.fieldId === fieldId) ?? [];
  const alerts = (data?.alerts.filter((alert) => alert.fieldId === fieldId) ?? [])
    .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt))
    .slice(0, 5);
  const notFound = !!data && !field;
  const id = encodeURIComponent(fieldId);
  const panel = {
    asOf: query.data?.asOf,
    isLoading: query.isLoading,
    error: query.error,
    onRetry: () => void query.refetch(),
  };

  return (
    <M3Shell
      eyebrow={farm ? `${farm.name} · ${farm.region}` : "Field"}
      title={field?.name ?? (notFound ? "Field not found" : "Field")}
      description={
        field
          ? `${field.crop} · ${field.growthStage} · ${field.areaHa.toFixed(1)} ha`
          : "Crop, targets, devices and recent alerts for one field."
      }
      headerAction={
        <Link href="/" className="button-secondary hover:!border-[var(--accent)] hover:!text-[var(--accent)]">
          ← All farms
        </Link>
      }
    >
      {notFound ? (
        <div className="empty-state">
          <p>We could not find a field called “{fieldId}”. It may have been removed.</p>
          <Link href="/" className="action-link mt-3 inline-block">
            Back to the overview
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          <nav aria-label="Related views" className="flex flex-wrap gap-2">
            <Link href={`/live?field=${id}`} className="button-primary">
              Live conditions
            </Link>
            <Link href={`/analytics?field=${id}`} className="button-secondary">
              History and indicators
            </Link>
          </nav>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Current conditions" {...panel}>
              {field ? (
                <div className="space-y-4">
                  <StatusChip status={field.status} />
                  <dl className="grid grid-cols-3 gap-3 text-sm">
                    <div className="stat-card">
                      <dt className="muted text-xs">
                        <span aria-hidden="true">{METRIC_ICON.soil_moisture}</span> Soil moisture
                      </dt>
                      <dd className="mt-1 text-xl font-semibold">{reading(field.moisture, "%")}</dd>
                    </div>
                    <div className="stat-card">
                      <dt className="muted text-xs">
                        <span aria-hidden="true">{METRIC_ICON.air_temperature}</span> Air temperature
                      </dt>
                      <dd className="mt-1 text-xl font-semibold">{reading(field.temperature, " °C")}</dd>
                    </div>
                    <div className="stat-card">
                      <dt className="muted text-xs">
                        <span aria-hidden="true">{METRIC_ICON.air_humidity}</span> Air humidity
                      </dt>
                      <dd className="mt-1 text-xl font-semibold">{reading(field.humidity, "%")}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </Panel>

            {field ? <FieldInsights fieldId={fieldId} fieldIds={data?.fields.map((item) => item.id) ?? []} targets={field.targets} /> : null}

            <Panel title="Target ranges" {...panel}>
              {field ? <Targets field={field} /> : null}
            </Panel>

            <Panel title="Devices" {...panel} isEmpty={!!data && devices.length === 0} emptyText="No devices are assigned to this field.">
              <ul className="space-y-2">
                {devices.map((device) => (
                  <li key={device.id} className="device-card flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      <strong className="block">{device.name}</strong>
                      <span className="muted text-xs">
                        Last seen {timeAgo(device.lastSeen)} · battery {Math.round(device.batteryPct)}% · {device.gapCount24h}{" "}
                        {device.gapCount24h === 1 ? "gap" : "gaps"} in 24 h
                      </span>
                    </span>
                    <DeviceChip status={device.status} />
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Recent alerts" {...panel} isEmpty={!!data && alerts.length === 0} emptyText="No alerts for this field.">
              <ul className="space-y-2">
                {alerts.map((alert) => (
                  <li key={alert.id}>
                    <Link href={`/alerts?alert=${encodeURIComponent(alert.id)}`} className="alert-row">
                    <span className={`severity-icon ${alert.severity}`} aria-hidden="true">
                      {alert.severity === "critical" ? "!" : alert.severity === "warning" ? "▲" : "i"}
                    </span>
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="block">{alert.message}</span>
                      <span className="muted text-xs">
                        {formatDateTime(alert.openedAt)} · {alert.status}
                      </span>
                    </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href="/alerts" className="action-link mt-3 inline-block">
                Open the alerts page
              </Link>
            </Panel>
          </div>
        </div>
      )}
    </M3Shell>
  );
}

export function FieldDetailPage({ fieldId }: { fieldId: string }) {
  return (
    <M3QueryProvider>
      <FieldDetailContent fieldId={fieldId} />
    </M3QueryProvider>
  );
}
