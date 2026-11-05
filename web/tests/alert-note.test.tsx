import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Alert } from "@/lib/types";
import { AlertTimeline } from "@/features/alerts/components/AlertTimeline";
import { timelineFor } from "@/features/alerts/timeline";

describe("alert note rendering", () => {
  it("escapes HTML from an operator note instead of injecting it", () => {
    const alert: Alert = {
      id: "a-note",
      type: "threshold",
      severity: "warning",
      fieldId: "field-n01",
      status: "acknowledged",
      openedAt: "2026-11-04T08:00:00.000Z",
      acknowledgedAt: "2026-11-04T08:10:00.000Z",
      acknowledgedBy: "Test Operator",
      message: "Test alert",
      note: '<img src=x onerror="alert(1)">',
    };

    const markup = renderToStaticMarkup(
      createElement(AlertTimeline, { entries: timelineFor(alert) }),
    );

    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
    expect(markup).toContain("Test Operator");
  });
});
