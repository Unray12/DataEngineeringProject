import type { Series } from "@/types";

/** Received samples / explicitly configured expected slots, deduplicated per metric+slot. */
export function monitoringCoverage(
  series: Series[],
  start: number,
  end: number,
  intervalSeconds: number,
): number | null {
  if (
    !series.length ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds <= 0
  )
    return null;
  const step = intervalSeconds * 1000;
  const expectedPerMetric = Math.ceil((end - start) / step);
  const metrics = new Map<string, Set<number>>();
  for (const resource of series) {
    const slots = metrics.get(resource.metric) ?? new Set<number>();
    metrics.set(resource.metric, slots);
    for (const point of resource.points) {
      const t = Date.parse(point.t);
      if (t <= start || t > end || point.value === null || !Number.isFinite(t))
        continue;
      if (
        resource.gaps.some(
          (gap) => t >= Date.parse(gap.start) && t <= Date.parse(gap.end),
        )
      )
        continue;
      slots.add(
        Math.min(expectedPerMetric - 1, Math.ceil((t - start) / step) - 1),
      );
    }
  }
  const received = [...metrics.values()].reduce(
    (sum, slots) => sum + slots.size,
    0,
  );
  return Math.min(100, (received / (expectedPerMetric * metrics.size)) * 100);
}

/** Insert null boundary points even when a producer omits null readings inside gaps. */
export function chartPoints(series: Series) {
  const points = series.points.map((point) => ({
    time: Date.parse(point.t),
    value:
      point.quality === "valid" &&
      !series.gaps.some(
        (gap) =>
          Date.parse(point.t) > Date.parse(gap.start) &&
          Date.parse(point.t) < Date.parse(gap.end),
      )
        ? point.value
        : null,
  }));
  for (const gap of series.gaps) {
    points.push(
      { time: Date.parse(gap.start), value: null },
      { time: Date.parse(gap.end), value: null },
    );
  }
  return points.sort((a, b) => a.time - b.time);
}

/** Keep target bands inside the plot even when all measurements are below/above target. */
export function chartDomain(
  series: Series,
  target?: { min: number; max: number },
): [number, number] {
  const values = chartPoints(series).flatMap((point) =>
    point.value === null ? [] : [point.value],
  );
  if (target) values.push(target.min, target.max);
  if (!values.length) return [0, 1];
  const min = Math.min(...values),
    max = Math.max(...values);
  return min === max ? [min - 1, max + 1] : [min, max];
}
