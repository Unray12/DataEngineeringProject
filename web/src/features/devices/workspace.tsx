"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { M3Shell } from "@/components/m3-shell";
import { useDevices, useDeviceStatus, useFarms, useFields } from "./hooks";
import {
  formatTime,
  formatSignal,
  isStale,
  observationAge,
} from "./presentation";

export function DevicesWorkspace({ preview = false }: { preview?: boolean }) {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <DevicesContent preview={preview} />
    </QueryClientProvider>
  );
}
function DevicesContent({ preview }: { preview: boolean }) {
  const [farm, setFarm] = useState(""),
    [field, setField] = useState(""),
    [status, setStatus] = useState("");
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
  const rows = (list.data?.data ?? [])
    .filter(
      (row) =>
        (!farm || fields.data?.data.some((item) => item.id === row.fieldId)) &&
        (!field || row.fieldId === field) &&
        (!status || row.status === status),
    )
    .sort((a, b) =>
      sort === "lastSeen"
        ? Date.parse(b.lastSeen) - Date.parse(a.lastSeen)
        : sort === "status"
          ? a.status.localeCompare(b.status)
          : a.id.localeCompare(b.id),
    );
  const fieldIds = farm
    ? (fields.data?.data.map((row) => row.id) ?? [])
    : [...new Set(list.data?.data.map((row) => row.fieldId))];
  const refresh = () => {
    void list.refetch();
    if (selected) void detail.refetch();
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
    >
      <section className="panel mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label>
            Farm
            <select
              className="select-control block"
              aria-label="Farm filter"
              value={farm}
              onChange={(e) => {
                setFarm(e.target.value);
                setField("");
              }}
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
              value={field}
              onChange={(e) => setField(e.target.value)}
            >
              <option value="">All fields</option>
              {fieldIds.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              className="select-control block"
              aria-label="Device status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {["online", "stale", "offline"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Sort
            <select
              className="select-control block"
              aria-label="Device sort"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="id">Device</option>
              <option value="lastSeen">Latest observation</option>
              <option value="status">Status</option>
            </select>
          </label>
          <button
            className="button-secondary"
            disabled={list.isFetching || detail.isFetching}
            onClick={refresh}
          >
            Refresh
          </button>
        </div>
        {farms.isPending && <p role="status">Loading farm filters…</p>}
        {farms.isError && (
          <p role="alert">
            Farm filters unavailable.{" "}
            <button onClick={() => void farms.refetch()}>Retry farms</button>
          </p>
        )}
        {farm && fields.isPending && (
          <p role="status">Loading field filters…</p>
        )}
        {farm && fields.isError && (
          <p role="alert">
            Field filters unavailable.{" "}
            <button onClick={() => void fields.refetch()}>Retry fields</button>
          </p>
        )}
      </section>
      <p className="muted mb-3 text-sm">
        {preview ? "Preview data · " : ""}Polls every 30 seconds while visible;
        refreshes on focus. Times shown in{" "}
        {process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Ho_Chi_Minh"}.
      </p>
      <p
        className="muted mb-3 text-sm"
        title="Stale observations are older than 90 seconds. Offline is reported by the service based on the device reporting interval; it is not inferred from a failed HTTP request."
      >
        Stale: observation older than 90 seconds. Offline: device outage
        reported by the service.
      </p>
      {list.data && (
        <p className="muted mb-3 text-sm">
          Data as of {formatTime(list.data.meta.asOf)} · snapshot retrieved;
          observation times below show actual freshness.
        </p>
      )}
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
          <div className="table-scroll">
            <table
              className="data-table m3-sticky-first"
              aria-label="Device continuity"
            >
              <thead>
                <tr>
                  {[
                    "Device",
                    "Field",
                    "Reported status",
                    "Observation age",
                    "Last reading",
                    "Battery",
                    "Signal",
                    "Gaps in 24 h",
                    "Details",
                  ].map((label) => (
                    <th scope="col" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.fieldId}</td>
                    <td>
                      <span
                        className={`status-chip ${row.status === "online" ? "resolved" : row.status === "offline" ? "open" : "acknowledged"}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      {observationAge(row.lastSeen, now)}{" "}
                      {isStale(row.lastSeen, now) && (
                        <strong className="text-amber-700">
                          Stale observation
                        </strong>
                      )}
                    </td>
                    <td>{formatTime(row.lastSeen)}</td>
                    <td>{row.batteryPct}%</td>
                    <td>{formatSignal(row.rssi)}</td>
                    <td>{row.gapCount24h}</td>
                    <td>
                      <button
                        className="button-secondary"
                        onClick={() => setSelected(row.id)}
                      >
                        View status
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 &&
            (!farm || !fields.isPending) &&
            !fields.isError && (
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
                <p className="muted mt-3">
                  Data as of {formatTime(detail.data.meta.asOf)} · snapshot
                  retrieved
                </p>
                <dl className="mt-3 grid gap-2">
                  <dt>Reported status</dt>
                  <dd>{detail.data.data.status}</dd>
                  <dt>Last reading</dt>
                  <dd>{formatTime(detail.data.data.lastSeen)}</dd>
                  <dt>Battery</dt>
                  <dd>{detail.data.data.batteryPct}%</dd>
                  <dt>Signal</dt>
                  <dd>{formatSignal(detail.data.data.rssi)}</dd>
                  <dt>Gaps in 24 h</dt>
                  <dd>{detail.data.data.gapCount24h}</dd>
                </dl>
                {isStale(detail.data.data.lastSeen, now) && (
                  <p role="status">
                    Stale observation: last reading is older than 90 seconds.
                  </p>
                )}
              </>
            )}
            <p className="muted mt-4">
              Full gap history and recent readings are not available through the
              frozen device-status contract.
            </p>
          </aside>
        </div>
      )}
    </M3Shell>
  );
}
