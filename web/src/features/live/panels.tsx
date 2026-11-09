"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isStale } from "@/features/devices/presentation";
import { formatClock } from "@/lib/datetime";
import { Tooltip } from "@/components/shared/tooltip";

export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** True for a moment after `value` changes, so a refreshed figure can briefly stand out. */
export function useFlash(value: unknown, ms = 1400) {
  const [on, setOn] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setOn(true);
    const timer = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return on;
}

/** Green pulsing dot while data is fresh, a still orange dot once it is stale. */
export function PulseDot({ live }: { live: boolean }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5" aria-hidden="true">
      {live && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-500" : "bg-orange-500"}`}
      />
    </span>
  );
}

function ago(seconds: number): string {
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

/** Clock time only ("22:35:01"); the long date adds noise on a live panel. */
const clock = formatClock;

export function Freshness({
  asOf,
  observedAt,
}: {
  asOf: string;
  observedAt?: string;
}) {
  const now = useNow();
  const stale = isStale(observedAt ?? asOf, now);
  const seconds = Math.max(0, Math.floor((now - Date.parse(observedAt ?? asOf)) / 1000));
  const detail = observedAt
    ? `Last reading ${clock(observedAt)} · page refreshed ${clock(asOf)}`
    : `Data as of ${clock(asOf)}`;
  return (
    <p className="muted mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <PulseDot live={!stale} />
      <Tooltip text={detail}>
        <span>{Number.isFinite(seconds) ? ago(seconds) : "—"}</span>
      </Tooltip>
      {stale && (
        <strong className="text-orange-600" role="status">
          Stale: older than 90 s
        </strong>
      )}
    </p>
  );
}

export function DataPanel({
  title,
  icon,
  action,
  pending,
  error,
  retry,
  asOf,
  children,
}: {
  title: string;
  icon?: string;
  action?: ReactNode;
  pending?: boolean;
  error?: Error | null;
  retry: () => unknown;
  asOf?: string;
  children?: ReactNode;
}) {
  return (
    <section className="surface-card min-w-0 p-5" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold capitalize">
          {icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </h2>
        {action}
      </div>
      {asOf && <Freshness asOf={asOf} />}
      {pending && (
        <div className="loading-panel mt-3 animate-pulse" role="status">
          Loading {title.toLowerCase()}…
        </div>
      )}
      {error && (
        <p className="empty-state mt-3" role="alert">
          {error.message} {asOf && "Showing the last successful snapshot."}{" "}
          <button className="button-secondary" onClick={() => retry()}>
            Retry {title.toLowerCase()}
          </button>
        </p>
      )}
      {children}
    </section>
  );
}
