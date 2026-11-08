import { describe, expect, it } from "vitest";
import {
  ALL,
  applyScope,
  countDevices,
  devicesNeedingAttention,
  isStale,
  timeAgo,
  topOpenAlerts,
  type OverviewData,
} from "@/features/overview/summary";
import { alerts, devices, farms, fields } from "@/lib/mock/base";

const data: OverviewData = { farms, fields, devices, alerts };

describe("scope", () => {
  it("keeps everything when nothing is selected", () => {
    const scoped = applyScope(data, { farmId: ALL, fieldId: ALL });
    expect(scoped.fields).toHaveLength(fields.length);
    expect(scoped.devices).toHaveLength(devices.length);
  });

  it("limits fields, devices and alerts to the selected farm", () => {
    const farm = farms[0];
    const scoped = applyScope(data, { farmId: farm.id, fieldId: ALL });
    expect(scoped.farms.map((item) => item.id)).toEqual([farm.id]);
    expect(scoped.fields.every((field) => field.farmId === farm.id)).toBe(true);
    const ids = new Set(scoped.fields.map((field) => field.id));
    expect(scoped.devices.every((device) => ids.has(device.fieldId))).toBe(true);
    expect(scoped.alerts.every((alert) => ids.has(alert.fieldId))).toBe(true);
  });

  it("selects nothing for a field outside the chosen farm", () => {
    const outside = fields.find((field) => field.farmId !== farms[0].id)!;
    const scoped = applyScope(data, { farmId: farms[0].id, fieldId: outside.id });
    expect(scoped.fields).toEqual([]);
    expect(scoped.devices).toEqual([]);
  });

  it("shows a newly added farm and field without code changes", () => {
    const farm = { ...farms[0], id: "farm-new", name: "New farm", fieldCount: 1, deviceCount: 0 };
    const field = { ...fields[0], id: "field-new", farmId: "farm-new", name: "New field" };
    const scoped = applyScope({ ...data, farms: [...farms, farm], fields: [...fields, field] }, { farmId: ALL, fieldId: ALL });
    expect(scoped.farms.map((item) => item.id)).toContain("farm-new");
    expect(scoped.fields.map((item) => item.id)).toContain("field-new");
  });
});

describe("devices and alerts", () => {
  it("counts devices by status", () => {
    const counts = countDevices(devices);
    expect(counts.online + counts.stale + counts.offline).toBe(devices.length);
    expect(counts.total).toBe(devices.length);
  });

  it("lists offline devices before stale ones and never online ones", () => {
    const list = devicesNeedingAttention(devices, 100);
    expect(list.every((device) => device.status !== "online")).toBe(true);
    const firstStale = list.findIndex((device) => device.status === "stale");
    const lastOffline = list.map((device) => device.status).lastIndexOf("offline");
    if (firstStale !== -1 && lastOffline !== -1) expect(lastOffline).toBeLessThan(firstStale);
  });

  it("returns only open alerts, most severe first, within the limit", () => {
    const top = topOpenAlerts(alerts, 3);
    expect(top.length).toBeLessThanOrEqual(3);
    expect(top.every((alert) => alert.status === "open")).toBe(true);
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    for (let index = 1; index < top.length; index += 1) {
      expect(rank[top[index - 1].severity]).toBeLessThanOrEqual(rank[top[index].severity]);
    }
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");

  it("flags data older than 90 seconds", () => {
    expect(isStale("2026-11-07T09:58:31Z", now)).toBe(false);
    expect(isStale("2026-11-07T09:58:29Z", now)).toBe(true);
    expect(isStale("not a date", now)).toBe(true);
  });

  it("describes elapsed time in plain words", () => {
    expect(timeAgo("2026-11-07T09:59:50Z", now)).toBe("just now");
    expect(timeAgo("2026-11-07T09:48:00Z", now)).toBe("12 min ago");
    expect(timeAgo("2026-11-07T07:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-05T10:00:00Z", now)).toBe("2 days ago");
    expect(timeAgo("garbage", now)).toBe("unknown");
  });
});
