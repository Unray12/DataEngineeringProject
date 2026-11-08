"use client";
import { useEffect, useState, type ReactNode } from "react";
import { formatTime, isStale } from "@/features/devices/presentation";

export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
export function Freshness({
  asOf,
  observedAt,
}: {
  asOf: string;
  observedAt?: string;
}) {
  const now = useNow();
  return (
    <p className="muted mt-2 text-sm">
      Data as of {formatTime(asOf)}
      {isStale(observedAt ?? asOf, now) && (
        <strong className="ml-2" role="status">
          Stale data: older than 90 seconds
        </strong>
      )}
      {observedAt && (
        <span className="block">Last observation {formatTime(observedAt)}</span>
      )}
    </p>
  );
}
export function DataPanel({
  title,
  pending,
  error,
  retry,
  asOf,
  children,
}: {
  title: string;
  pending?: boolean;
  error?: Error | null;
  retry: () => unknown;
  asOf?: string;
  children?: ReactNode;
}) {
  return (
    <section className="panel min-w-0 p-4" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {asOf && <Freshness asOf={asOf} />}
      {pending && (
        <div className="loading-panel animate-pulse" role="status">
          Loading {title.toLowerCase()}…
        </div>
      )}
      {error && (
        <p className="empty-state" role="alert">
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
