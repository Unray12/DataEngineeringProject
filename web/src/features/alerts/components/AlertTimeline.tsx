"use client";

import type { TimelineEntry } from "../timeline";
import { formatDateTime } from "../format";

function toneClass(tone: TimelineEntry["tone"]): string {
  if (tone === "danger") return "danger";
  if (tone === "warn") return "warn";
  if (tone === "ok") return "ok";
  return "muted";
}

export function AlertTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return <p className="muted text-sm">chưa có dữ liệu</p>;
  }

  return (
    <ol className="timeline" aria-label="Alert status timeline">
      {entries.map((entry) => (
        <li key={entry.key} className="timeline-item">
          <span className={`timeline-dot ${toneClass(entry.tone)}`} aria-hidden="true" />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">{entry.label}</p>
            <time className="muted text-xs" dateTime={entry.at ?? undefined}>
              {formatDateTime(entry.at)}
            </time>
          </div>
          {entry.by && <p className="muted mt-1 text-xs">By {entry.by}</p>}
          {entry.note && (
            // Rendered as a text node on purpose: alert notes are operator
            // input and must never be interpreted as HTML.
            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-black/5 px-3 py-2 text-sm">
              {entry.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
