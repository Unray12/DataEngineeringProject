import { devices, MOCK_NOW } from "@/lib/mock/base";
import type { DeviceContinuity, Metric } from "@/types";
import { ApiError } from "@/lib/api/errors";

/** Synthetic device-level demo fixture. Does not relabel field readings as device observations. */
export function mockContinuity(id: string): DeviceContinuity {
  const device = devices.find((row) => row.id === id);
  if (!device) throw new ApiError(404, "Device was not found.", "not_found");
  const lastSeen = Date.parse(device.lastSeen);
  const start = MOCK_NOW - 24 * 3_600_000;
  const gaps: { start: string; end: string | null }[] = [];
  const ongoing = MOCK_NOW - lastSeen > 5 * 60_000;
  const closedCount = Math.max(0, device.gapCount24h - (ongoing ? 1 : 0));
  // Seeded historical demo intervals reconcile with the canonical summary count.
  const historyEnd = Math.min(lastSeen - 60 * 60_000, MOCK_NOW - 60 * 60_000);
  const spacing = (historyEnd - start) / (closedCount + 1);
  for (let index = 0; index < closedCount; index += 1) {
    const gapStart = start + (index + 1) * spacing;
    gaps.push({
      start: new Date(gapStart).toISOString(),
      end: new Date(gapStart + 5 * 60_000).toISOString(),
    });
  }
  if (ongoing)
    gaps.push({
      start: new Date(lastSeen + 5 * 60_000).toISOString(),
      end: null,
    });
  const metrics: { metric: Metric; unit: string; baseline: number }[] = [
    { metric: "soil_moisture", unit: "%", baseline: 42 },
    { metric: "air_temperature", unit: "°C", baseline: 26 },
  ];
  const seed = [...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0);
  const readings = metrics
    .flatMap(({ metric, unit, baseline }) =>
      Array.from({ length: 288 }, (_, index) => {
        const timestamp = lastSeen - index * 5 * 60_000;
        return {
          deviceId: id,
          metric,
          measuredAt: new Date(timestamp).toISOString(),
          value:
            Math.round((baseline + Math.sin((seed + index) / 8) * 3) * 10) / 10,
          unit,
          quality: "valid" as const,
        };
      }),
    )
    .filter(
      (row) =>
        Date.parse(row.measuredAt) > start &&
        !gaps.some(
          (gap) =>
            Date.parse(row.measuredAt) >= Date.parse(gap.start) &&
            (gap.end === null ||
              Date.parse(row.measuredAt) <= Date.parse(gap.end)),
        ),
    )
    .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt))
    .slice(0, 40);
  return { availability: "available", deviceId: id, gaps, readings };
}
