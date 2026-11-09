"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { M3Shell } from "@/components/m3-shell";
import { Dropdown } from "@/components/shared/dropdown";
import { Tooltip } from "@/components/shared/tooltip";
import { METRIC_ICON } from "@/features/insights/types";
import { DataProvider } from "@/lib/api/provider";
import {
  useFarms,
  useFields,
  useLatest,
  useSeries,
  useActiveAlerts,
  liveQueryOptions,
} from "@/lib/api/hooks";
import { read } from "@/lib/api/read";
import { seriesEnvelopeSchema } from "@/lib/api/schemas";
import type { Field, Metric } from "@/types";
import { useMonitoringScope } from "./scope";
import { DataPanel, Freshness, PulseDot, useFlash, useNow } from "./panels";
import { GapChart } from "./chart";
import { monitoringCoverage } from "./continuity";

const METRICS: Metric[] = [
  "soil_moisture",
  "soil_temperature",
  "air_temperature",
  "air_humidity",
  "rainfall",
];
const label = (metric: Metric) => metric.replaceAll("_", " ");
const ALL = "";

type Reading = {
  metric: Metric;
  value: number;
  unit: string;
  measuredAt: string;
  quality: "valid" | "suspect" | "invalid";
  state: "low" | "ok" | "high";
};

// Colour follows meaning (inside or outside the healthy range); the words and arrows carry it too.
const STATE_CHIP = {
  ok: { text: "In range", icon: "✓", tone: "bg-emerald-500/10 text-emerald-600" },
  low: { text: "Below target", icon: "▼", tone: "bg-orange-500/10 text-orange-600" },
  high: { text: "Above target", icon: "▲", tone: "bg-orange-500/10 text-orange-600" },
} as const;

function StateChip({ reading, hasTarget }: { reading: Reading; hasTarget: boolean }) {
  if (reading.quality !== "valid") {
    return (
      <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-xs font-semibold">
        Excluded · {reading.quality}
      </span>
    );
  }
  if (!hasTarget) return <span className="muted text-xs">No target range</span>;
  const chip = STATE_CHIP[reading.state];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${chip.tone}`}>
      {chip.icon} {chip.text}
    </span>
  );
}

function Value({ reading, big = false }: { reading: Reading; big?: boolean }) {
  const flash = useFlash(reading.value);
  return (
    <p
      className={`font-semibold transition-colors duration-700 ${big ? "text-3xl" : "text-xl"} ${
        flash ? "rounded-lg bg-emerald-500/20" : ""
      }`}
    >
      {reading.quality === "valid" ? reading.value.toFixed(1) : "—"}
      <span className="muted ml-1 text-sm font-normal">{reading.unit}</span>
    </p>
  );
}

function MetricPanel({ field, metric }: { field: Field; metric: Metric }) {
  const series = useSeries(field.id, metric),
    latest = useLatest(field.id);
  const current = latest.data?.data.metrics.find((row) => row.metric === metric);
  const target = field.targets?.[metric];
  return (
    <DataPanel
      title={label(metric)}
      icon={METRIC_ICON[metric]}
      pending={series.isPending || latest.isPending}
      error={series.error ?? latest.error}
      retry={() => {
        void series.refetch();
        void latest.refetch();
      }}
      asOf={series.data?.meta.asOf}
    >
      {latest.data &&
        (current ? (
          <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
            <Value reading={current} big />
            <StateChip reading={current} hasTarget={Boolean(target)} />
          </div>
        ) : (
          <p className="empty-state mt-3">No current reading.</p>
        ))}
      {series.data && <GapChart series={series.data.data} target={target} />}
    </DataPanel>
  );
}

function Coverage({ fieldId, interval }: { fieldId: string; interval: number }) {
  const now = useNow();
  const resources = useQueries({
    queries: METRICS.map((metric) => ({
      queryKey: ["live", fieldId, "series", metric],
      queryFn: () =>
        read(
          `/api/fields/${encodeURIComponent(fieldId)}/series?hours=24&metric=${metric}`,
          seriesEnvelopeSchema,
        ),
      ...liveQueryOptions,
    })),
  });
  const pending = resources.some((row) => row.isPending),
    failed = resources.find((row) => row.error);
  const end = now,
    start = end - 86_400_000;
  const available = resources.flatMap((row) => (row.data ? [row.data.data] : []));
  const coverage =
    !pending && !failed && available.length === METRICS.length
      ? monitoringCoverage(available, start, end, interval * 60)
      : null;
  const percent = coverage === null ? null : Math.max(0, Math.min(100, coverage));
  return (
    <div className="mt-4" aria-label="Monitoring coverage">
      {pending ? (
        <p className="muted animate-pulse text-sm" role="status">
          Loading coverage…
        </p>
      ) : failed ? (
        <p role="alert" className="text-sm">
          Coverage unavailable.{" "}
          <button
            className="button-secondary"
            onClick={() => resources.forEach((row) => void row.refetch())}
          >
            Retry coverage
          </button>
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between text-sm">
            <Tooltip
              text={`Received samples across five metrics / expected samples in 24 hours, at one reading every ${interval} minutes.`}
            >
              <span className="font-semibold">Monitoring coverage (24 h)</span>
            </Tooltip>
            <span className="font-semibold">{percent === null ? "Unavailable" : `${percent.toFixed(1)}%`}</span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--line)]"
            role="progressbar"
            aria-label="Monitoring coverage"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                percent !== null && percent < 80 ? "bg-orange-500" : "bg-emerald-500"
              }`}
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function FieldCard({ field, interval }: { field: Field; interval: number }) {
  const latest = useLatest(field.id),
    scope = useMonitoringScope();
  const metrics = latest.data?.data.metrics ?? [];
  const attention = metrics.some(
    (row) => row.quality === "valid" && field.targets?.[row.metric] && row.state !== "ok",
  );
  return (
    <DataPanel
      title={field.name}
      icon="🌾"
      action={
        latest.data ? (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              attention ? "bg-orange-500/10 text-orange-600" : "bg-emerald-500/10 text-emerald-600"
            }`}
          >
            {attention ? "▲ Needs attention" : "✓ All in range"}
          </span>
        ) : undefined
      }
      pending={latest.isPending}
      error={latest.error}
      retry={latest.refetch}
    >
      {latest.data && (
        <>
          {metrics.length === 0 && <p className="empty-state mt-3">No current readings.</p>}
          <ul className="mt-3 grid grid-cols-2 gap-2">
            {metrics.map((row) => (
              <li key={row.metric} className="device-card">
                <p className="muted text-xs capitalize">
                  <span aria-hidden="true">{METRIC_ICON[row.metric]}</span> {label(row.metric)}
                </p>
                <Value reading={row} />
                <div className="mt-1">
                  <StateChip reading={row} hasTarget={Boolean(field.targets?.[row.metric])} />
                </div>
              </li>
            ))}
          </ul>
          <Freshness
            asOf={latest.data.meta.asOf}
            observedAt={metrics.map((row) => row.measuredAt).sort()[0]}
          />
        </>
      )}
      <Coverage fieldId={field.id} interval={interval} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          className="button-primary"
          href={scope.href("/live", field.id)}
        >
          View field charts
        </Link>
        <Link className="action-link inline-flex items-center self-stretch" href={scope.href("/devices", field.id)}>
          View devices
        </Link>
      </div>
    </DataPanel>
  );
}

function ActiveAlerts() {
  const scope = useMonitoringScope();
  const alerts = useActiveAlerts({
    farmId: scope.farmId || undefined,
    fieldId: scope.fieldId || undefined,
  });
  return (
    <DataPanel
      title="Active alerts"
      icon="🔔"
      pending={alerts.isPending}
      error={alerts.error}
      retry={alerts.refetch}
      asOf={alerts.data?.meta.asOf}
    >
      {alerts.data &&
        (alerts.data.data.length ? (
          <ul className="mt-3 space-y-2">
            {alerts.data.data.map((alert) => (
              <li key={alert.id}>
                <Link href={scope.href("/alerts", alert.fieldId)} className="alert-row">
                  <span className={`severity-icon ${alert.severity}`} aria-hidden="true">
                    {alert.severity === "critical" ? "!" : alert.severity === "warning" ? "▲" : "i"}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <strong className="block capitalize">
                      {alert.severity} · {alert.status}
                    </strong>
                    <span className="muted">{alert.message}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state mt-3">✅ No active alerts in this scope.</p>
        ))}
    </DataPanel>
  );
}

function LiveContent({ preview }: { preview: boolean }) {
  const scope = useMonitoringScope(),
    farms = useFarms(),
    fields = useFields(scope.farmId || undefined),
    alerts = useActiveAlerts({
      farmId: scope.farmId || undefined,
      fieldId: scope.fieldId || undefined,
    });
  const [interval, setInterval] = useState(5);
  const visible =
    fields.data?.data.filter((field) => !scope.fieldId || field.id === scope.fieldId) ?? [];
  const open = alerts.data?.data.length;
  return (
    <M3Shell
      eyebrow="BR2 · BR3"
      title="Live monitor"
      description="Current field conditions, recent trends and monitoring continuity."
      headerAction={
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
          <PulseDot live />
          Live · refreshes every 30 s
        </span>
      }
    >
      <section
        className="surface-card mb-5 flex flex-wrap items-end gap-3 p-4"
        aria-label="Monitoring controls"
      >
        <div className="filter-field">
          Farm
          <Dropdown
            label="Farm filter"
            value={scope.farmId}
            options={[
              { value: ALL, label: "All farms" },
              ...(farms.data?.data.map((row) => ({ value: row.id, label: row.name })) ?? []),
            ]}
            onChange={(farmId) => scope.setScope({ farmId, fieldId: "" })}
          />
        </div>
        <div className="filter-field">
          Field
          <Dropdown
            label="Field filter"
            value={scope.fieldId}
            options={[
              { value: ALL, label: "All fields" },
              ...(fields.data?.data.map((row) => ({ value: row.id, label: row.name })) ?? []),
            ]}
            onChange={(fieldId) => scope.setScope({ fieldId })}
          />
        </div>
        <div className="filter-field">
          Expected reading interval
          <Dropdown
            label="Expected reading interval"
            value={interval}
            options={[1, 5, 10, 15, 30].map((value) => ({ value, label: `${value} minutes` }))}
            onChange={setInterval}
          />
        </div>
        <p className="muted min-w-[14rem] flex-1 text-xs">
          {preview
            ? "Preview data. Demo schedule: 5 minutes."
            : "Set the expected device schedule before interpreting coverage."}
        </p>
      </section>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <div className="stat-card">
          <p className="muted text-xs">🌾 Fields in scope</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl">{fields.data ? visible.length : "—"}</p>
          <p className="muted mt-2 text-xs">{farms.data ? `${farms.data.data.length} farms` : "Loading"}</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">🔔 Active alerts</p>
          <p
            className={`mt-2 text-2xl font-semibold sm:text-3xl ${
              open ? "text-orange-600" : ""
            }`}
          >
            {open ?? "—"}
          </p>
          <p className="muted mt-2 text-xs">Open or acknowledged</p>
        </div>
        <div className="stat-card col-span-2 lg:col-span-1">
          <p className="muted text-xs">⏱ Refresh</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl">30 s</p>
          <p className="muted mt-2 text-xs">Paused while the tab is hidden</p>
        </div>
      </div>

      {fields.error && (
        <DataPanel
          title="Fields"
          pending={false}
          error={fields.error}
          retry={() => {
            void fields.refetch();
            void farms.refetch();
          }}
        />
      )}
      {fields.data && visible.length === 0 && (
        <p className="empty-state">No fields match this scope.</p>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {visible.map((field) => (
          <FieldCard key={field.id} field={field} interval={interval} />
        ))}
      </div>
      {scope.fieldId && visible[0] && (
        <div className="my-5 grid min-w-0 gap-4 xl:grid-cols-2">
          {METRICS.map((metric) => (
            <MetricPanel key={metric} field={visible[0]} metric={metric} />
          ))}
        </div>
      )}
      {!scope.fieldId && (
        <p className="muted my-4 text-sm">
          Choose “View field charts” to inspect five metric charts, target bands and gap intervals.
        </p>
      )}
      <div className="mt-5">
        <ActiveAlerts />
      </div>
    </M3Shell>
  );
}
export function LiveWorkspace({ preview }: { preview: boolean }) {
  return (
    <DataProvider>
      <LiveContent preview={preview} />
    </DataProvider>
  );
}
