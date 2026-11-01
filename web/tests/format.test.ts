import { describe, expect, it } from "vitest";
import { isStale, seriesHasGap } from "@/lib/format";

describe("monitoring freshness", () => {
  it("marks data older than 90 seconds as stale", () => {
    const now = Date.parse("2026-10-31T12:00:00.000Z");
    expect(isStale("2026-10-31T11:58:29.000Z", 90, now)).toBe(true);
    expect(isStale("2026-10-31T11:59:31.000Z", 90, now)).toBe(false);
  });
});

describe("series gaps", () => {
  it("detects null points without interpolating them", () => {
    expect(seriesHasGap([{ value: 1 }, { value: null }, { value: 2 }])).toBe(true);
  });
});
