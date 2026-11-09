/**
 * One date and time style for the whole app, in the display time zone.
 *
 *   formatDateTime         9 Nov 2026, 22:35      events, alerts, snapshots
 *   formatDateTimeSeconds  9 Nov 2026, 22:35:01   live readings (seconds matter)
 *   formatClock            22:35:01               "last reading" and freshness
 *   formatDay              9 Nov 2026 / 9 Nov     daily buckets and chart axes
 *
 * Timestamps are UTC in transport and shown in NEXT_PUBLIC_TIMEZONE.
 */

const UNAVAILABLE = "Unavailable";

// Formatters are built per time zone and cached, so a changed NEXT_PUBLIC_TIMEZONE is honoured.
const cache = new Map<string, Intl.DateTimeFormat>();
function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${key}|${options.timeZone}`;
  let found = cache.get(id);
  if (!found) {
    found = new Intl.DateTimeFormat("en-GB", options);
    cache.set(id, found);
  }
  return found;
}
const zone = () => process.env.NEXT_PUBLIC_TIMEZONE || "Asia/Ho_Chi_Minh";

const dateTime = () => formatter("dt", { timeZone: zone(), dateStyle: "medium", timeStyle: "short" });
const dateTimeSeconds = () => formatter("dts", { timeZone: zone(), dateStyle: "medium", timeStyle: "medium" });
const clock = () => formatter("clock", { timeZone: zone(), timeStyle: "medium" });
// Day buckets are calendar dates with no time zone, so they are formatted in UTC to never shift a day.
const dayWithYear = () => formatter("dy", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const dayShort = () => formatter("d", { timeZone: "UTC", day: "numeric", month: "short" });

function parse(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = parse(value);
  return date ? dateTime().format(date) : UNAVAILABLE;
}

export function formatDateTimeSeconds(value: string | number | Date | null | undefined): string {
  const date = parse(value);
  return date ? dateTimeSeconds().format(date) : UNAVAILABLE;
}

export function formatClock(value: string | number | Date | null | undefined): string {
  const date = parse(value);
  return date ? clock().format(date) : UNAVAILABLE;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-07" -> "7 Nov 2026" (or "7 Nov" for chart axes). A value with a time falls back to date and time. */
export function formatDay(value: string | null | undefined, withYear = true): string {
  if (!value) return UNAVAILABLE;
  if (!DAY_ONLY.test(value)) return formatDateTime(value);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return UNAVAILABLE;
  return (withYear ? dayWithYear() : dayShort()).format(date);
}
