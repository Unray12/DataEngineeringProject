"use client";

import { useEffect } from "react";
import type { DeviceQuality } from "@/lib/types";
import { formatDateTime, formatPercent } from "@/features/alerts/format";
import {
  flaggedCount,
  lineageLocation,
  missingBreakdown,
  sortLineage,
  validRate,
} from "../lineage";
import { QUALITY_TERM_LABELS } from "../glossary";

type LineageDrawerProps = {
  row: DeviceQuality;
  onClose: () => void;
};

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="muted text-xs">{label}</p>
      <p className="mt-1 font-semibold">
        {value === null ? "chưa có dữ liệu" : value.toLocaleString("en-GB")}
      </p>
    </div>
  );
}

export function LineageDrawer({ row, onClose }: LineageDrawerProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const rate = validRate(row.counts);
  const flagged = flaggedCount(row.counts);
  const missing = missingBreakdown(row.counts);
  const lineage = sortLineage(row.lineage);

  return (
    <div
      className="drawer-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lineage-drawer-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Traceability</p>
            <h2 id="lineage-drawer-title" className="mt-1 text-xl font-semibold">
              {row.deviceId}
            </h2>
            <p className="muted mt-1 text-sm">Where this device&apos;s records came from.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close lineage detail">
            ×
          </button>
        </div>

        <section className="mt-6 rounded-xl border border-[var(--line)] p-4">
          <h3 className="text-sm font-semibold">Quality counts</h3>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Count label="Total" value={row.counts.total} />
            <Count label="Valid" value={row.counts.valid} />
            <Count label="Duplicate" value={row.counts.duplicate} />
            <Count label="Out of range" value={row.counts.outOfRange} />
            <Count label="Quarantined" value={row.counts.quarantined} />
            <Count label="Flagged" value={flagged} />
            <div>
              <p className="muted text-xs">Valid rate</p>
              <p className="mt-1 font-semibold text-emerald-600">
                {rate === null ? "chưa có dữ liệu" : formatPercent(rate)}
              </p>
            </div>
            <div>
              <p className="muted text-xs">Last batch</p>
              <p className="mt-1 font-semibold">
                {row.lastBatchId === undefined || row.lastBatchId === null
                  ? "chưa có dữ liệu"
                  : `#${row.lastBatchId}`}
              </p>
            </div>
          </div>
          {missing.length > 0 && (
            <p className="muted mt-3 text-xs">
              Not provided by the serving API: {missing.map((field) => QUALITY_TERM_LABELS[field] ?? field).join(", ")} —{" "}
              chưa có dữ liệu.
            </p>
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-semibold">Lineage records</h3>
          {lineage.length === 0 ? (
            <p className="muted mt-3 text-sm">
              chưa có dữ liệu — the serving API does not expose lineage for this device yet.
            </p>
          ) : (
            <ol className="timeline mt-3">
              {lineage.map((entry) => (
                <li key={`${entry.batchId}-${entry.partition}-${entry.offset}`} className="timeline-item">
                  <span className="timeline-dot" aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">Batch #{entry.batchId}</p>
                    <time className="muted text-xs" dateTime={entry.ingestedAt}>
                      {formatDateTime(entry.ingestedAt)}
                    </time>
                  </div>
                  <p className="muted mt-1 text-xs">{lineageLocation(entry)}</p>
                  <p className="muted mt-1 text-xs">
                    Ingested {formatDateTime(entry.ingestedAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>

        <p className="muted mt-6 border-t border-[var(--line)] pt-4 text-xs">
          Lineage is technical metadata. It is shown on /quality only so you can trace a value back
          to the batch and stream position that produced it.
        </p>
      </aside>
    </div>
  );
}
