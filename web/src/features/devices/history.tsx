"use client";
import { useDeviceContinuity } from "@/lib/api/hooks";
import { formatTime } from "./presentation";
import { Freshness } from "@/features/live/panels";

export function DeviceHistory({
  id,
  preview,
}: {
  id: string;
  preview: boolean;
}) {
  const history = useDeviceContinuity(id);
  return (
    <section
      className="mt-5"
      aria-label="Device gap history and recent readings"
    >
      <h3 className="font-semibold">Gap history and recent readings</h3>
      {preview && (
        <p className="muted text-sm">
          Synthetic device demo history; counts match the preview summary.
          Field-level charts are a separate aggregate.
        </p>
      )}
      {history.isPending && (
        <p className="animate-pulse" role="status">
          Loading device history…
        </p>
      )}
      {history.error && (
        <p role="alert">
          {history.error.message}{" "}
          <button
            className="button-secondary"
            onClick={() => void history.refetch()}
          >
            Retry history
          </button>
        </p>
      )}
      {history.data && (
        <>
          <Freshness asOf={history.data.meta.asOf} />
          {history.data.data.availability === "unavailable" ? (
            <p className="empty-state">{history.data.data.reason}</p>
          ) : (
            <>
              <h4 className="mt-3 font-semibold">Gaps in the last 24 hours</h4>
              {history.data.data.gaps.length ? (
                <ul>
                  {history.data.data.gaps.map((gap, index) => (
                    <li className="mt-2" key={`${gap.start}-${index}`}>
                      Start: {formatTime(gap.start)}
                      <br />
                      End: {gap.end ? formatTime(gap.end) : "Ongoing"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No recorded gaps.</p>
              )}
              <h4 className="mt-4 font-semibold">Recent device readings</h4>
              {history.data.data.readings.length ? (
                <div className="table-scroll max-h-80">
                  <table
                    className="data-table"
                    aria-label="Recent device readings"
                  >
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Metric</th>
                        <th scope="col">Value</th>
                        <th scope="col">Quality</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.data.readings.map((row, index) => (
                        <tr key={`${row.metric}-${row.measuredAt}-${index}`}>
                          <td>{formatTime(row.measuredAt)}</td>
                          <td>{row.metric.replaceAll("_", " ")}</td>
                          <td>
                            {row.value === null
                              ? "Missing"
                              : row.quality === "valid"
                                ? `${row.value} ${row.unit}`
                                : "Excluded"}
                          </td>
                          <td>{row.quality}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>No recent readings.</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
