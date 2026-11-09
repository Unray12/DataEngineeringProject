import { formatDateTimeSeconds } from "@/lib/datetime";

export const STALE_AFTER_MS = 90_000;
export function isStale(lastSeen: string, now: number): boolean {
  const observed = Date.parse(lastSeen);
  return !Number.isFinite(observed) || now - observed > STALE_AFTER_MS;
}
export function observationAge(lastSeen: string, now: number): string {
  const observed = Date.parse(lastSeen);
  return Number.isFinite(observed)
    ? `${Math.max(0, Math.floor((now - observed) / 1000))}s`
    : "Unavailable";
}
export function formatTime(value: string): string {
  return formatDateTimeSeconds(value);
}
export function liveQueryOptions() {
  return {
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always" as const,
    retry: false as const,
  };
}

/** Existing mock fixtures put normalized quality in rssi; never label that dBm. */
export function formatSignal(value: number): string {
  if (value < 0) return `${value} dBm`;
  if (value <= 1) return `${Math.round(value * 100)}% quality`;
  return "Unavailable";
}
