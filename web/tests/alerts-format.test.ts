import { describe, expect, it } from "vitest";
import { isStale } from "@/features/alerts/format";

describe("alert data freshness", () => {
  it("marks data older than the 90 second budget as stale", () => {
    const now = Date.parse("2026-10-31T12:00:00.000Z");
    expect(isStale("2026-10-31T11:58:29.000Z", 90, now)).toBe(true);
    expect(isStale("2026-10-31T11:59:31.000Z", 90, now)).toBe(false);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isStale("not-a-date", 90, Date.now())).toBe(true);
  });
});
