import { describe, expect, it } from "vitest";
import type { Alert } from "@/lib/types";
import { currentEvent, timelineFor } from "@/features/alerts/timeline";

function alert(patch: Partial<Alert> = {}): Alert {
  return {
    id: "a-timeline",
    type: "threshold",
    severity: "critical",
    fieldId: "field-h01",
    status: "open",
    openedAt: "2026-11-04T08:00:00.000Z",
    message: "Soil moisture below target",
    ...patch,
  };
}

describe("alert timeline", () => {
  it("always starts with the opening event", () => {
    const entries = timelineFor(alert());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "opened",
      status: "open",
      at: "2026-11-04T08:00:00.000Z",
      tone: "danger",
    });
  });

  it("adds acknowledgement with responder and note", () => {
    const entries = timelineFor(
      alert({
        status: "acknowledged",
        acknowledgedAt: "2026-11-04T08:10:00.000Z",
        acknowledgedBy: "Linh Nguyen",
        note: "Called the field team.",
      }),
    );
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      key: "acknowledged",
      status: "acknowledged",
      at: "2026-11-04T08:10:00.000Z",
      by: "Linh Nguyen",
      note: "Called the field team.",
    });
  });

  it("adds the resolved event and keeps the note on the latest event", () => {
    const entries = timelineFor(
      alert({
        status: "resolved",
        acknowledgedAt: "2026-11-04T08:10:00.000Z",
        acknowledgedBy: "Linh",
        resolvedAt: "2026-11-04T09:00:00.000Z",
        resolvedBy: "Minh",
        note: "Irrigation restored.",
      }),
    );
    expect(entries.map((entry) => entry.key)).toEqual(["opened", "acknowledged", "resolved"]);
    expect(entries[2].note).toBe("Irrigation restored.");
    expect(entries[1].note).toBeUndefined();
  });

  it("does not invent an acknowledgement for a direct open -> resolved transition", () => {
    const entries = timelineFor(
      alert({
        status: "resolved",
        resolvedAt: "2026-11-04T09:00:00.000Z",
        resolvedBy: "system",
      }),
    );
    expect(entries.map((entry) => entry.key)).toEqual(["opened", "resolved"]);
  });

  it("keeps missing API timestamps as null instead of guessing", () => {
    const entries = timelineFor(alert({ status: "acknowledged" }));
    expect(entries[1]).toMatchObject({ key: "acknowledged", at: null });

    const resolved = timelineFor(alert({ status: "resolved" }));
    expect(resolved[resolved.length - 1]).toMatchObject({ key: "resolved", at: null });
  });

  it("returns the latest event for the current-status chip", () => {
    expect(currentEvent(alert()).key).toBe("opened");
    expect(currentEvent(alert({ status: "acknowledged" })).key).toBe("acknowledged");
  });
});
