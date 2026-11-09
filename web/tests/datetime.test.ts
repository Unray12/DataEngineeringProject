import { afterEach, describe, expect, it, vi } from "vitest";
import { formatClock, formatDateTime, formatDateTimeSeconds, formatDay } from "../src/lib/datetime";

afterEach(() => vi.unstubAllEnvs());

describe("shared date and time style", () => {
  it("shows events in the display time zone, to the minute or the second", () => {
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "Asia/Ho_Chi_Minh");
    expect(formatDateTime("2026-11-09T15:35:01Z")).toBe("9 Nov 2026, 22:35");
    expect(formatDateTimeSeconds("2026-11-09T15:35:01Z")).toBe("9 Nov 2026, 22:35:01");
    expect(formatClock("2026-11-09T15:35:01Z")).toBe("22:35:01");
  });

  it("follows a changed time zone", () => {
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "UTC");
    expect(formatClock("2026-11-09T15:35:01Z")).toBe("15:35:01");
  });

  it("formats daily buckets as calendar days without shifting them", () => {
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "Pacific/Kiritimati");
    expect(formatDay("2026-11-07")).toBe("7 Nov 2026");
    expect(formatDay("2026-11-07", false)).toBe("7 Nov");
  });

  it("falls back to date and time for a bucket that has a time, and never prints Invalid Date", () => {
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "UTC");
    expect(formatDay("2026-11-07T14:00:00Z")).toBe("7 Nov 2026, 14:00");
    expect(formatDateTime("not a date")).toBe("Unavailable");
    expect(formatDateTime(null)).toBe("Unavailable");
    expect(formatDay("")).toBe("Unavailable");
  });
});
