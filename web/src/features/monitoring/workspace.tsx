"use client";
import { useEffect, useState } from "react";
import { M3Shell } from "@/components/m3-shell";

type Device = {
  device_id: string;
  farm_id?: string;
  field_id?: string;
  status: string;
  last_seen?: string | null;
  updated_at?: string | null;
  reporting_interval_s?: number | null;
  gap_start?: string | null;
  gap_end?: string | null;
  source?: string;
};
type DevicePage = { rows: Device[]; source: string };
const formatTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "Unavailable";
async function read<T>(path: string): Promise<T> {
  const response = await fetch(`/api/monitoring/${path}`, {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error("Device data is unavailable. Please retry.");
  return response.json() as Promise<T>;
}

export function DevicesWorkspace() {
  const [data, setData] = useState<DevicePage | null>(null),
    [error, setError] = useState(""),
    [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [farm, setFarm] = useState(""),
    [field, setField] = useState(""),
    [status, setStatus] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Device | null>(null),
    [detailError, setDetailError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      read<DevicePage>("devices")
        .then((result) => {
          if (active) {
            setData(result);
            setCheckedAt(Date.now());
            setError("");
          }
        })
        .catch((reason) => {
          if (active) setError(String(reason.message));
        });
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [attempt]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    read<Device>(`devices/${encodeURIComponent(selected)}/status`)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch((reason) => {
        if (active) setDetailError(String(reason.message));
      });
    return () => {
      active = false;
    };
  }, [selected, checkedAt, attempt]);
  const rows =
    data?.rows.filter(
      (row) =>
        (!farm || row.farm_id === farm) &&
        (!field || row.field_id === field) &&
        (!status || row.status === status),
    ) ?? [];
  const farms = [
    ...new Set(
      data?.rows
        .map((row) => row.farm_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const fields = [
    ...new Set(
      data?.rows
        .filter((row) => !farm || row.farm_id === farm)
        .map((row) => row.field_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  return (
    <M3Shell
      eyebrow="BR3 · Monitoring continuity"
      title="Devices"
      description="Check device availability, the last observation, and the latest reported gap state."
    >
      <section className="panel mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Farm
            <select
              className="select-control block"
              aria-label="Farm filter"
              value={farm}
              onChange={(event) => {
                setFarm(event.target.value);
                setField("");
              }}
            >
              <option value="">All farms</option>
              {farms.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Field
            <select
              className="select-control block"
              aria-label="Field filter"
              value={field}
              onChange={(event) => setField(event.target.value)}
            >
              <option value="">All fields</option>
              {fields.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select
              className="select-control block"
              aria-label="Device status filter"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {["online", "stale", "offline", "unknown"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            className="button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Refresh
          </button>
        </div>
      </section>
      {error && (
        <p role="alert" className="empty-state">
          {error}{" "}
          <button
            className="button-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {!data && !error ? (
        <p role="status">Loading devices…</p>
      ) : (
        data && (
          <>
            <p className="muted mb-3 text-sm">
              {data.source === "mock" ? "Preview data · " : ""}Status retrieved{" "}
              {checkedAt ? new Date(checkedAt).toLocaleString() : "—"} ·
              refreshes every 30 seconds
            </p>
            <div className="table-scroll">
              <table className="data-table" aria-label="Device continuity">
                <thead>
                  <tr>
                    {[
                      "Device",
                      "Field",
                      "Status",
                      "Last reading",
                      "Age",
                      "Reporting interval",
                      "Open gap",
                      "Details",
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.device_id}>
                      <td>{row.device_id}</td>
                      <td>{row.field_id ?? "Unavailable"}</td>
                      <td>{row.status}</td>
                      <td>{formatTime(row.last_seen)}</td>
                      <td>
                        {row.last_seen && checkedAt
                          ? `${Math.max(0, Math.floor((checkedAt - Date.parse(row.last_seen)) / 1000))}s`
                          : "Unavailable"}
                      </td>
                      <td>
                        {row.reporting_interval_s == null
                          ? "Unavailable"
                          : `${row.reporting_interval_s}s`}
                      </td>
                      <td>
                        {row.gap_start && checkedAt
                          ? `${Math.max(0, Math.floor((checkedAt - Date.parse(row.gap_start)) / 60000))} min`
                          : "None reported"}
                      </td>
                      <td>
                        <button
                          className="button-secondary"
                          onClick={() => setSelected(row.device_id)}
                        >
                          View status
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <p className="empty-state">No devices match these filters.</p>
            )}
          </>
        )
      )}
      {selected && (
        <section className="panel mt-5 p-5" aria-label="Device status">
          <h2 className="text-lg font-semibold">Status · {selected}</h2>
          {detailError ? (
            <p role="alert">
              {detailError}{" "}
              <button
                className="button-secondary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry status
              </button>
            </p>
          ) : !detail ? (
            <p role="status">Loading status…</p>
          ) : (
            <dl className="mt-3 grid gap-2">
              <div>
                <dt>Status</dt>
                <dd>{detail.status}</dd>
              </div>
              <div>
                <dt>Last reading</dt>
                <dd>{formatTime(detail.last_seen)}</dd>
              </div>
              <div>
                <dt>Reported gap start</dt>
                <dd>{formatTime(detail.gap_start)}</dd>
              </div>
              <div>
                <dt>Reported gap end</dt>
                <dd>{formatTime(detail.gap_end)}</dd>
              </div>
            </dl>
          )}
          <p className="muted mt-4 text-sm">
            The existing service exposes the latest device state. Full gap
            history and reliable gap counts are unavailable.
          </p>
        </section>
      )}
    </M3Shell>
  );
}
