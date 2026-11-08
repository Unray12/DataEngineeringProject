"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatInTimeZone } from "date-fns-tz";
import {
  DEVICE_ICON,
  DEVICE_TEXT,
  STATUS_ICON,
  STATUS_TEXT,
  isStale,
} from "./summary";

const TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE ?? "Asia/Ho_Chi_Minh";

function formatTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), TIMEZONE, "HH:mm:ss");
  } catch {
    return "unknown time";
  }
}

export function formatDateTime(iso: string): string {
  try {
    return formatInTimeZone(new Date(iso), TIMEZONE, "d MMM, HH:mm");
  } catch {
    return "unknown time";
  }
}

/** Status is always icon + text, never colour alone. */
export function StatusChip({ status }: { status: keyof typeof STATUS_TEXT }) {
  return (
    <span className={`status-chip ${status}`}>
      <span aria-hidden="true" className="mr-1">
        {STATUS_ICON[status]}
      </span>
      {STATUS_TEXT[status]}
    </span>
  );
}

export function DeviceChip({ status }: { status: keyof typeof DEVICE_TEXT }) {
  return (
    <span className={`status-chip ${status}`}>
      <span aria-hidden="true" className="mr-1">
        {DEVICE_ICON[status]}
      </span>
      {DEVICE_TEXT[status]}
    </span>
  );
}

/**
 * "Data as of …" label. `live` data older than 90 s gets a stale warning;
 * analytical data is labelled as not live instead.
 */
function Freshness({ asOf, live = true }: { asOf: string; live?: boolean }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const stale = live && now !== null && isStale(asOf, now);
  return (
    <p className="muted text-xs" role={stale ? "status" : undefined}>
      Data as of {formatTime(asOf)}
      {live ? "" : " · historical data, not live"}
      {stale ? (
        <strong className="ml-2 text-amber-600">
          <span aria-hidden="true">▲ </span>This data may be out of date.
        </strong>
      ) : null}
    </p>
  );
}

type PanelProps = {
  title: string;
  asOf?: string;
  live?: boolean;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyText?: string;
  action?: ReactNode;
  children: ReactNode;
};

/** Every data panel gets a skeleton, an error with retry, and an empty state. */
export function Panel({
  title,
  asOf,
  live = true,
  isLoading,
  error,
  onRetry,
  isEmpty,
  emptyText = "Nothing to show yet.",
  action,
  children,
}: PanelProps) {
  return (
    <section className="surface-card p-5" aria-label={title}>
      <div className="section-heading mb-4">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {asOf && !isLoading && !error ? <Freshness asOf={asOf} live={live} /> : null}
        </div>
        {action}
      </div>
      {isLoading ? (
        <div className="loading-panel" role="status">
          Loading…
        </div>
      ) : error ? (
        <div className="empty-state" role="alert">
          <p>{error.message}</p>
          {onRetry ? (
            <button type="button" className="button-secondary mt-3" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      ) : isEmpty ? (
        <div className="empty-state">{emptyText}</div>
      ) : (
        children
      )}
    </section>
  );
}
