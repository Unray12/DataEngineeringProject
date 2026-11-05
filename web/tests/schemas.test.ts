import { describe, expect, it } from "vitest";
import {
  alertSchema,
  alertsEnvelopeSchema,
  deviceQualitySchema,
  qualityDaySchema,
} from "@/lib/api/schemas";
import { alerts, deviceQuality, qualityDays } from "@/lib/mock/base";

describe("M3 payload schemas", () => {
  it("parses every mock alert", () => {
    for (const alert of alerts) {
      expect(alertSchema.safeParse(alert).success).toBe(true);
    }
  });

  it("parses the alert envelope", () => {
    const result = alertsEnvelopeSchema.safeParse({
      data: alerts,
      meta: { asOf: new Date().toISOString(), source: "cassandra" },
    });
    expect(result.success).toBe(true);
  });

  it("parses every daily quality bucket", () => {
    for (const day of qualityDays) {
      expect(qualityDaySchema.safeParse(day).success).toBe(true);
    }
  });

  it("parses per-device quality with lineage", () => {
    for (const row of deviceQuality) {
      expect(deviceQualitySchema.safeParse(row).success).toBe(true);
    }
  });

  it("rejects a malformed alert", () => {
    const result = alertSchema.safeParse({
      id: "a-bad",
      type: "not-a-type",
      severity: "warning",
      fieldId: "field-n01",
      status: "open",
      openedAt: new Date().toISOString(),
      message: "Bad alert",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a note longer than the FastAPI limit", () => {
    const result = alertSchema.safeParse({
      ...alerts[0],
      note: "x".repeat(501),
    });
    expect(result.success).toBe(false);
  });
});
