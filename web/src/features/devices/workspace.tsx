"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DataProvider } from "@/lib/api/provider";
import { useMonitoringScope } from "@/features/live/scope";
import { DeviceHistory } from "./history";
import type { Device } from "@/lib/types";
import Link from "next/link";
import { M3Shell } from "@/components/m3-shell";
import { Dropdown } from "@/components/shared/dropdown";
import { formatClock } from "@/lib/datetime";
import { Tooltip } from "@/components/shared/tooltip";
import { PulseDot } from "@/features/live/panels";
import { useDevices, useDeviceStatus, useFarms, useFields } from "./hooks";
import {
  formatSignal,
  isStale,
} from "./presentation";

const STATUS = {
  online: { text: "Online", chip: "resolved" },
  stale: { text: "Stale", chip: "acknowledged" },
  offline: { text: "Offline", chip: "open" },
} as const;

function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

/** Clock time only; the long date adds noise on a live page. */
const clock = formatClock;

function Meter({ label, percent, tone }: { label: string; percent: number | null; tone: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="h-1.5 overflow-hidden rounded-full bg-[var(--line)]"
    >
      <div className={`h-full rounded-full transition-all duration-700 ${tone}`} style={{ width: `${percent ?? 0}%` }} />
    </div>
  );
}

const batteryTone = (pct: number) => (pct < 20 ? "bg-rose-500" : pct < 40 ? "bg-orange-500" : "bg-emerald-500");

function DeviceCard({
  row,
  fieldName,
  now,
  onOpen,
}: {
  row: Device;
  fieldName: string;
  now: number;
  onOpen: () => void;
}) {
  const stale = isStale(row.lastSeen, now);
  const signalPct = row.rssi >= 0 && row.rssi <= 1 ? Math.round(row.rssi * 100) : null;
  const seconds = Math.max(0, Math.floor((now - Date.parse(row.lastSeen)) / 1000));
  const status = STATUS[row.status];
  return (
    <li className="surface-card flex min-w-0 flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">📡 {row.id}</p>
          <p className="muted truncate text-xs">{fieldName}</p>
        </div>
        <span className={`status-chip ${status.chip}`}>
          {row.status === "online" && <PulseDot live />}
          <span className={row.status === "online" ? "ml-1.5" : ""}>{status.text}</span>
        </span>
      </div>

      <p className="muted mt-3 flex flex-wrap items-center gap-x-2 text-xs">
        <PulseDot live={!stale} />
        <Tooltip text={`Last reading ${clock(row.lastSeen)}`}>
          <span>{Number.isFinite(seconds) ? ago(seconds) : "—"}</span>
        </Tooltip>
        {stale && <strong className="text-orange-600">Stale: older than 90 s</strong>}
      </p>

      <div className="mt-3 space-y-2.5 text-xs">
        <div>
          <div className="mb-1 flex justify-between">
            <span className="muted">🔋 Battery</span>
            <span className="font-semibold">{Math.round(row.batteryPct)}%</span>
          </div>
          <Meter label="Battery" percent={Math.round(row.batteryPct)} tone={batteryTone(row.batteryPct)} />
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span className="muted">📶 Signal</span>
            <span className="font-semibold">{formatSignal(row.rssi)}</span>
          </div>
          <Meter label="Signal" percent={signalPct} tone="bg-emerald-500" />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            row.gapCount24h > 0 ? "bg-orange-500/10 text-orange-600" : "bg-emerald-500/10 text-emerald-600"
          }`}
        >
          {row.gapCount24h > 0
            ? `▲ ${row.gapCount24h} ${row.gapCount24h === 1 ? "gap" : "gaps"} in 24 h`
            : "✓ No gaps in 24 h"}
        </span>
        <button className="button-secondary hover:!border-[var(--accent)]" onClick={onOpen}>
          View status
        </button>
      </div>
    </li>
  );
}

export function DevicesWorkspace({ preview = false }: { preview?: boolean }) {
  return (
    <DataProvider>
      <DevicesContent preview={preview} />
    </DataProvider>
  );
}
function DevicesContent({ preview }: { preview: boolean }) {
  const scope = useMonitoringScope();
  const queryClient = useQueryClient();
  const farm = scope.farmId,
    field = scope.fieldId;
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(""),
    [sort, setSort] = useState("id");
  const [now, setNow] = useState(() => Date.now());
  const list = useDevices(),
    detail = useDeviceStatus(selected),
    farms = useFarms(),
    fields = useFields(farm);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected("");
    };
    window.addEventListener("keydown", onKey);
    const previous = document.activeElement as HTMLElement | null;
    document.getElementById("close-device")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [selected]);
  const inScope = (list.data?.data ?? []).filter(
    (row) =>
      (!farm || fields.data?.data.some((item) => item.id === row.fieldId)) &&
      (!field || row.fieldId === field),
  );
  const count = (value: string) => inScope.filter((row) => row.status === value).length;
  const rows = inScope
    .filter((row) => !status || row.status === status)
    .sort((a, b) =>
      sort === "lastSeen"
        ? Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
        : sort === "status"
          ? a.status.localeCompare(b.status)
          : a.id.localeCompare(b.id),
    );
  const fieldName = (id: string) => fields.data?.data.find((item) => item.id === id)?.name ?? id;
  const fieldIds = farm
    ? (fields.data?.data.map((row) => row.id) ?? [])
    : [...new Set(list.data?.data.map((row) => row.fieldId))];
  const refresh = () => {
    void list.refetch();
    if (selected) {
      void detail.refetch();
      void queryClient.invalidateQueries({
        queryKey: ["devices", selected, "continuity"],
      });
    }
  };
  const error =
    list.error instanceof Error
      ? list.error.message
      : "Device data is unavailable.";
  return (
    <M3Shell
      eyebrow="BR3 · Monitoring continuity"
      title="Devices"
      description="Check device availability and the age of the latest reported observation."
      headerAction={
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
          <PulseDot live />
          Live · refreshes every 30 s
        </span>
      }
    >
      <section className="surface-card mb-5 p-4" aria-label="Device filters">
        <div className="flex flex-wrap items-end gap-3">
          <div className="filter-field">
            Farm
            <Dropdown
              label="Farm filter"
              value={farm}
              options={[
                { value: "", label: "All farms" },
                ...(farms.data?.data.map((row) => ({ value: row.id, label: row.name })) ?? []),
              ]}
              onChange={(farmId) => scope.setScope({ farmId, fieldId: "" })}
            />
          </div>
          <div className="filter-field">
            Field
            <Dropdown
              label="Field filter"
              value={field}
              options={[{ value: "", label: "All fields" }, ...fieldIds.map((id) => ({ value: id, label: fieldName(id) }))]}
              onChange={(fieldId) => scope.setScope({ fieldId })}
            />
          </div>
          <div className="filter-field">
            Status
            <Dropdown
              label="Device status filter"
              value={status}
              options={[
                { value: "", label: "All statuses" },
                { value: "online", label: "Online" },
                { value: "stale", label: "Stale" },
                { value: "offline", label: "Offline" },
              ]}
              onChange={setStatus}
            />
          </div>
          <div className="filter-field">
            Sort
            <Dropdown
              label="Device sort"
              value={sort}
              options={[
                { value: "id", label: "Device" },
                { value: "lastSeen", label: "Latest observation" },
                { value: "status", label: "Status" },
              ]}
              onChange={setSort}
            />
          </div>
          <button
            className="button-primary disabled:opacity-50"
            disabled={list.isFetching || detail.isFetching}
            onClick={refresh}
          >
            {list.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          <Link className="action-link ml-auto" href={scope.href("/live")}>
            View live field conditions →
          </Link>
        </div>
        {farms.isPending && <p role="status">Loading farm filters…</p>}
        {farms.isError && (
          <p role="alert">
            Farm filters unavailable.{" "}
            <button onClick={() => void farms.refetch()}>Retry farms</button>
          </p>
        )}
        {farm && fields.isPending && <p role="status">Loading field filters…</p>}
        {farm && fields.isError && (
          <p role="alert">
            Field filters unavailable.{" "}
            <button onClick={() => void fields.refetch()}>Retry fields</button>
          </p>
        )}
      </section>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="stat-card">
          <p className="muted text-xs">📡 Devices</p>
          <p className="mt-2 text-2xl font-semibold sm:text-3xl">{list.data ? inScope.length : "—"}</p>
          <p className="muted mt-2 text-xs">In the current view</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">✓ Online</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600 sm:text-3xl">{list.data ? count("online") : "—"}</p>
          <p className="muted mt-2 text-xs">Reporting normally</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">▲ Stale</p>
          <p className="mt-2 text-2xl font-semibold text-orange-600 sm:text-3xl">{list.data ? count("stale") : "—"}</p>
          <p className="muted mt-2 text-xs">Reading older than 90 s</p>
        </div>
        <div className="stat-card">
          <p className="muted text-xs">✕ Offline</p>
          <p className="mt-2 text-2xl font-semibold text-rose-600 sm:text-3xl">{list.data ? count("offline") : "—"}</p>
          <p className="muted mt-2 text-xs">Outage reported by the service</p>
        </div>
      </div>

      <p className="muted mb-3 flex flex-wrap items-center gap-x-2 text-xs">
        <PulseDot live={!list.isError} />
        <Tooltip
          text={`Stale means the latest reading is older than 90 seconds. Offline is reported by the service from the device reporting interval, not from a failed request. Times are in ${process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Ho_Chi_Minh"}.`}
        >
          <span>
            {preview ? "Preview data · " : ""}Updates every 30 s
            {list.data ? ` · data as of ${clock(list.data.meta.asOf)}` : ""}
          </span>
        </Tooltip>
      </p>
      {list.isError && (
        <p role="alert" className="empty-state">
          {error} {list.data ? "Showing the last successful snapshot." : ""}{" "}
          <button className="button-secondary" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
      {list.isPending && (
        <div role="status" className="loading-panel animate-pulse">
          Loading devices…
        </div>
      )}
      {list.data && (
        <>
          <ul className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Device continuity">
            {rows.map((row) => (
              <DeviceCard
                key={row.id}
                row={row}
                fieldName={fieldName(row.fieldId)}
                now={now}
                onOpen={() => setSelected(row.id)}
              />
            ))}
          </ul>
          {rows.length === 0 && (!farm || !fields.isPending) && !fields.isError && (
            <p className="empty-state">No devices match these filters.</p>
          )}
        </>
      )}
      {selected && (
        <div
          className="drawer-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelected("");
          }}
        >
          <aside
            className="drawer-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-status-title"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const targets = event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]), a[href], select",
              );
              const first = targets[0],
                last = targets[targets.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }}
          >
            <div className="flex items-center justify-between">
              <h2 id="device-status-title" className="text-lg font-semibold">
                Status · {selected}
              </h2>
              <button
                id="close-device"
                aria-label="Close device status"
                className="icon-button"
                onClick={() => setSelected("")}
              >
                ×
              </button>
            </div>
            <button
              className="button-secondary mt-3"
              disabled={list.isFetching || detail.isFetching}
              onClick={refresh}
            >
              Refresh status
            </button>
            {detail.isPending && (
              <div role="status" className="loading-panel animate-pulse">
                Loading status…
              </div>
            )}
            {detail.isError && (
              <p role="alert">
                {detail.error.message}{" "}
                <button
                  className="button-secondary"
                  onClick={() => void detail.refetch()}
                >
                  Retry status
                </button>
              </p>
            )}
            {detail.data && (
              <>
                <p className="muted mt-3 text-xs">
                  Data as of {clock(detail.data.meta.asOf)}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div className="stat-card">
                    <dt className="muted text-xs">Reported status</dt>
                    <dd className="mt-1 font-semibold capitalize">{detail.data.data.status}</dd>
                  </div>
                  <div className="stat-card">
                    <dt className="muted text-xs">Last reading</dt>
                    <dd className="mt-1 font-semibold">{clock(detail.data.data.lastSeen)}</dd>
                  </div>
                  <div className="stat-card">
                    <dt className="muted text-xs">🔋 Battery</dt>
                    <dd className="mt-1 font-semibold">{Math.round(detail.data.data.batteryPct)}%</dd>
                  </div>
                  <div className="stat-card">
                    <dt className="muted text-xs">📶 Signal</dt>
                    <dd className="mt-1 font-semibold">{formatSignal(detail.data.data.rssi)}</dd>
                  </div>
                  <div className="stat-card col-span-2">
                    <dt className="muted text-xs">Gaps in 24 h</dt>
                    <dd className="mt-1 font-semibold">{detail.data.data.gapCount24h}</dd>
                  </div>
                </dl>
                {isStale(detail.data.data.lastSeen, now) && (
                  <p role="status">
                    Stale observation: last reading is older than 90 seconds.
                  </p>
                )}
              </>
            )}
            <DeviceHistory id={selected} preview={preview} />
          </aside>
        </div>
      )}
    </M3Shell>
  );
}
