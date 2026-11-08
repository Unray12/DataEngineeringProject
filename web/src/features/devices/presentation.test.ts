import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatTime,
  formatSignal,
  isStale,
  observationAge,
} from "./presentation";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("BR3 observation freshness", () => {
  it("warns only after the 90-second threshold with a controlled clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-08T01:00:00Z"));
    const observed = new Date().toISOString();
    vi.advanceTimersByTime(90_000);
    expect(isStale(observed, Date.now())).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isStale(observed, Date.now())).toBe(true);
    expect(observationAge(observed, Date.now())).toBe("90s");
  });
  it("does not display invalid dates or NaN ages", () => {
    expect(formatTime("bad")).toBe("Unavailable");
    expect(observationAge("bad", Date.now())).toBe("Unavailable");
    expect(isStale("bad", Date.now())).toBe(true);
  });
  it("uses the configured timezone regardless of the browser timezone", () => {
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "Asia/Ho_Chi_Minh");
    expect(formatTime("2026-11-08T01:00:00Z")).toContain("08:00:00");
    vi.stubEnv("NEXT_PUBLIC_TIMEZONE", "UTC");
    expect(formatTime("2026-11-08T01:00:00Z")).toContain("01:00:00");
  });
});

it("distinguishes normalized fixture signal quality from RSSI", () => {
  expect(formatSignal(0.68)).toBe("68% quality");
  expect(formatSignal(-81)).toBe("-81 dBm");
  expect(formatSignal(2)).toBe("Unavailable");
});
