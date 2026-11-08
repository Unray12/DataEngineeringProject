import type { QualityDay } from "@/lib/types";
import { formatNumber, formatPercent } from "@/features/alerts/format";

export function QualitySummaryCards({
  days,
  loading,
  failed,
}: {
  days: QualityDay[] | undefined;
  loading: boolean;
  failed: boolean;
}) {
  const totals = days?.reduce(
    (sum, day) => ({
      total: sum.total + day.total,
      valid: sum.valid + day.valid,
      duplicate: sum.duplicate + day.duplicate,
      quarantined: sum.quarantined + day.quarantined,
    }),
    { total: 0, valid: 0, duplicate: 0, quarantined: 0 },
  );
  const placeholder = loading ? "Loading…" : "Unavailable";
  const rate =
    totals && totals.total > 0
      ? formatPercent((totals.valid / totals.total) * 100)
      : "—";
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      aria-label="Quality summary"
    >
      <div className="stat-card">
        <p className="muted text-xs">Records in range</p>
        <p className="mt-2 text-2xl font-semibold sm:text-3xl">
          {totals ? formatNumber(totals.total, 0) : placeholder}
        </p>
        <p className="muted mt-2 text-xs">
          {days
            ? failed
              ? "Last successful snapshot"
              : `${days.length} days of batch results`
            : "Waiting for a successful response"}
        </p>
      </div>
      <div className="stat-card">
        <p className="muted text-xs">Valid rate</p>
        <p className="mt-2 text-2xl font-semibold sm:text-3xl text-emerald-500">
          {totals ? rate : placeholder}
        </p>
        <p className="muted mt-2 text-xs">
          {totals
            ? `${formatNumber(totals.valid, 0)} valid records`
            : "Valid count unavailable"}
        </p>
      </div>
      <div className="stat-card">
        <p className="muted text-xs">Duplicates</p>
        <p className="mt-2 text-2xl font-semibold sm:text-3xl text-blue-500">
          {totals ? formatNumber(totals.duplicate, 0) : placeholder}
        </p>
        <p className="muted mt-2 text-xs">Kept once, counted here</p>
      </div>
      <div className="stat-card">
        <p className="muted text-xs">Quarantined</p>
        <p className="mt-2 text-2xl font-semibold sm:text-3xl text-rose-500">
          {totals ? formatNumber(totals.quarantined, 0) : placeholder}
        </p>
        <p className="muted mt-2 text-xs">Excluded from normal reporting</p>
      </div>
    </div>
  );
}
