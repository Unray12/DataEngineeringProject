import { describe, expect, it } from "vitest";
import type { Alert, AlertStatus } from "@/lib/types";
import {
  ALLOWED_TRANSITIONS,
  applyAlertAction,
  autoResolveOutage,
  canAct,
  transition,
  type AlertAction,
} from "@/features/alerts/state";

const EXPECTED: Record<AlertStatus, Record<AlertAction, AlertStatus | null>> = {
  open: { acknowledge: "acknowledged", resolve: "resolved" },
  acknowledged: { acknowledge: null, resolve: "resolved" },
  resolved: { acknowledge: null, resolve: null },
};

function makeAlert(patch: Partial<Alert> = {}): Alert {
  return {
    id: "a-test",
    type: "threshold",
    severity: "warning",
    fieldId: "field-n01",
    status: "open",
    openedAt: "2026-11-04T08:00:00.000Z",
    message: "Test alert",
    ...patch,
  };
}

describe("alert transition matrix", () => {
  for (const status of Object.keys(EXPECTED) as AlertStatus[]) {
    for (const action of Object.keys(EXPECTED[status]) as AlertAction[]) {
      const target = EXPECTED[status][action];
      it(`${status} + ${action} -> ${target ?? "rejected"}`, () => {
        const result = transition(status, action);
        if (target === null) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe("invalid_transition");
            expect(result.from).toBe(status);
            expect(result.allowed).toEqual(ALLOWED_TRANSITIONS[status]);
          }
        } else {
          expect(result).toEqual({ ok: true, status: target });
        }
      });
    }
  }

  it("keeps the same matrix as the backend contract", () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      open: ["acknowledged", "resolved"],
      acknowledged: ["resolved"],
      resolved: [],
    });
  });

  it("exposes actionable buttons that match the matrix", () => {
    expect(canAct("open")).toEqual({ acknowledge: true, resolve: true });
    expect(canAct("acknowledged")).toEqual({ acknowledge: false, resolve: true });
    expect(canAct("resolved")).toEqual({ acknowledge: false, resolve: false });
  });
});

describe("applyAlertAction", () => {
  const now = "2026-11-04T09:15:00.000Z";

  it("records who acknowledged and when", () => {
    const result = applyAlertAction(makeAlert(), "acknowledge", "Linh Nguyen", "Checked sensor", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.status).toBe("acknowledged");
    expect(result.alert.acknowledgedAt).toBe(now);
    expect(result.alert.acknowledgedBy).toBe("Linh Nguyen");
    expect(result.alert.note).toBe("Checked sensor");
  });

  it("records who resolved and when", () => {
    const result = applyAlertAction(
      makeAlert({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: "Linh" }),
      "resolve",
      "Minh Tran",
      undefined,
      "2026-11-04T10:00:00.000Z",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.status).toBe("resolved");
    expect(result.alert.resolvedAt).toBe("2026-11-04T10:00:00.000Z");
    expect(result.alert.resolvedBy).toBe("Minh Tran");
  });

  it("does not overwrite an existing note when the new note is empty", () => {
    const result = applyAlertAction(
      makeAlert({ note: "Existing note" }),
      "acknowledge",
      "Linh",
      "   ",
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.note).toBe("Existing note");
  });

  it("returns the invalid transition instead of mutating the alert", () => {
    const alert = makeAlert({ status: "resolved" });
    const result = applyAlertAction(alert, "resolve", "Linh", undefined, now);
    expect(result.ok).toBe(false);
  });
});

describe("autoResolveOutage", () => {
  const now = "2026-11-04T11:00:00.000Z";

  it("resolves an open outage alert when the device reports again", () => {
    const alert = makeAlert({ type: "device_outage", status: "open" });
    const resolved = autoResolveOutage(alert, "online", now);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBe(now);
    expect(resolved.resolvedBy).toBe("system");
  });

  it("leaves an acknowledged outage alert for the operator", () => {
    const alert = makeAlert({ type: "device_outage", status: "acknowledged" });
    expect(autoResolveOutage(alert, "online", now)).toEqual(alert);
  });

  it("ignores non-outage alerts and devices that are still offline", () => {
    const threshold = makeAlert({ type: "threshold", status: "open" });
    expect(autoResolveOutage(threshold, "online", now)).toEqual(threshold);

    const outage = makeAlert({ type: "device_outage", status: "open" });
    expect(autoResolveOutage(outage, "offline", now)).toEqual(outage);
  });
});
