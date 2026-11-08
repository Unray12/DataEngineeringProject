"use client";
import { useState } from "react";
import Link from "next/link";
import { useQueries } from "@tanstack/react-query";
import { M3Shell } from "@/components/m3-shell";
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
import { DataPanel, Freshness, useNow } from "./panels";
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
function MetricPanel({ field, metric }: { field: Field; metric: Metric }) {
  const series = useSeries(field.id, metric),
    latest = useLatest(field.id);
  const current = latest.data?.data.metrics.find(
    (row) => row.metric === metric,
  );
  return (
    <DataPanel
      title={label(metric)}
      pending={series.isPending || latest.isPending}
      error={series.error ?? latest.error}
      retry={() => {
        void series.refetch();
        void latest.refetch();
      }}
      asOf={series.data?.meta.asOf}
    >
      {latest.data && (
        <>
          {current ? (
            <>
              <p className="mt-3 text-2xl font-semibold">
                {current.quality === "valid"
                  ? `${current.value} ${current.unit}`
                  : "Excluded reading"}
              </p>
              <p>
                {current.quality === "valid"
                  ? field.targets?.[metric]
                    ? `Target state: ${current.state}`
                    : "No target range configured"
                  : `Quality: ${current.quality}`}
              </p>
              <Freshness
                asOf={latest.data.meta.asOf}
                observedAt={current.measuredAt}
              />
            </>
          ) : (
            <p className="empty-state">No current reading.</p>
          )}
        </>
      )}
      {series.data && (
        <GapChart series={series.data.data} target={field.targets?.[metric]} />
      )}
    </DataPanel>
  );
}
function Coverage({
  fieldId,
  interval,
}: {
  fieldId: string;
  interval: number;
}) {
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
  const available = resources.flatMap((row) =>
    row.data ? [row.data.data] : [],
  );
  const coverage =
    !pending && !failed && available.length === METRICS.length
      ? monitoringCoverage(available, start, end, interval * 60)
      : null;
  const asOf = resources
    .flatMap((row) => (row.data ? [row.data.meta.asOf] : []))
    .sort()[0];
  return (
    <div className="mt-3" aria-label="Monitoring coverage">
      {pending ? (
        <p className="animate-pulse" role="status">
          Loading coverage…
        </p>
      ) : failed ? (
        <p role="alert">
          Coverage unavailable.{" "}
          <button
            className="button-secondary"
            onClick={() => resources.forEach((row) => void row.refetch())}
          >
            Retry coverage
          </button>
        </p>
      ) : (
        <p className="font-semibold">
          Monitoring coverage:{" "}
          {coverage === null ? "Unavailable" : `${coverage.toFixed(1)}%`}
        </p>
      )}
      <p className="muted text-xs">
        Received samples across five metrics / expected samples in 24 hours;
        schedule: every {interval} minutes.
      </p>
      {asOf && <Freshness asOf={asOf} />}
    </div>
  );
}
function FieldCard({ field, interval }: { field: Field; interval: number }) {
  const latest = useLatest(field.id),
    scope = useMonitoringScope();
  return (
    <DataPanel
      title={field.name}
      pending={latest.isPending}
      error={latest.error}
      retry={latest.refetch}
    >
      {latest.data && (
        <>
          {latest.data.data.metrics.length === 0 && (
            <p className="empty-state">No current readings.</p>
          )}
          <dl className="mt-3 grid grid-cols-2 gap-2">
            {latest.data.data.metrics.map((row) => (
              <div key={row.metric}>
                <dt className="muted text-sm">{label(row.metric)}</dt>
                <dd>
                  {row.quality === "valid"
                    ? `${row.value} ${row.unit}`
                    : `Excluded (${row.quality})`}
                </dd>
              </div>
            ))}
          </dl>
          <Freshness
            asOf={latest.data.meta.asOf}
            observedAt={
              latest.data.data.metrics.map((row) => row.measuredAt).sort()[0]
            }
          />
        </>
      )}
      <Coverage fieldId={field.id} interval={interval} />
      <div className="mt-3 flex flex-wrap gap-3">
        <Link className="button-secondary" href={scope.href("/live", field.id)}>
          View field charts
        </Link>
        <Link href={scope.href("/devices", field.id)}>View devices</Link>
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
                <Link href={scope.href("/alerts", alert.fieldId)}>
                  {alert.severity} · {alert.status}: {alert.message}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No active alerts in this scope.</p>
        ))}
    </DataPanel>
  );
}
function LiveContent({ preview }: { preview: boolean }) {
  const scope = useMonitoringScope(),
    farms = useFarms(),
    fields = useFields(scope.farmId || undefined);
  const [interval, setInterval] = useState(5);
  const visible =
    fields.data?.data.filter(
      (field) => !scope.fieldId || field.id === scope.fieldId,
    ) ?? [];
  return (
    <M3Shell
      eyebrow="BR2 · BR3"
      title="Live monitor"
      description="Current field conditions, recent trends and monitoring continuity."
    >
      <section
        className="panel mb-5 flex flex-wrap items-end gap-3 p-4"
        aria-label="Monitoring controls"
      >
        <label>
          Farm
          <select
            className="select-control block"
            aria-label="Farm filter"
            value={scope.farmId}
            onChange={(event) =>
              scope.setScope({ farmId: event.target.value, fieldId: "" })
            }
          >
            <option value="">All farms</option>
            {farms.data?.data.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Field
          <select
            className="select-control block"
            aria-label="Field filter"
            value={scope.fieldId}
            onChange={(event) =>
              scope.setScope({ fieldId: event.target.value })
            }
          >
            <option value="">All fields</option>
            {fields.data?.data.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Expected reading interval
          <select
            className="select-control block"
            aria-label="Expected reading interval"
            value={interval}
            onChange={(event) => setInterval(Number(event.target.value))}
          >
            {[1, 5, 10, 15, 30].map((value) => (
              <option key={value} value={value}>
                {value} minutes
              </option>
            ))}
          </select>
        </label>
        <p className="muted text-sm">
          {preview
            ? "Preview data. Demo schedule: 5 minutes."
            : "Set the expected device schedule before interpreting coverage."}{" "}
          Polls every 30 seconds while visible.
        </p>
      </section>
      <DataPanel
        title="Fields"
        asOf={fields.data?.meta.asOf}
        pending={fields.isPending || farms.isPending}
        error={fields.error ?? farms.error}
        retry={() => {
          void fields.refetch();
          void farms.refetch();
        }}
      >
        {fields.data && (
          <p className="muted text-sm">
            {visible.length} fields in scope · {farms.data?.data.length ?? 0}{" "}
            farms. Choose a field for detailed charts.
          </p>
        )}
        {fields.data && visible.length === 0 && (
          <p className="empty-state">No fields match this scope.</p>
        )}
      </DataPanel>
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
        <p className="muted my-4">
          Choose “View field charts” to inspect five metric charts, target bands
          and gap intervals.
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
