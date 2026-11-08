import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QualitySummaryCards } from "@/features/quality/components/QualitySummaryCards";

describe("BR4 honest quality summary states", () => {
  it("shows loading instead of zero records before the first response", () => {
    const html = renderToStaticMarkup(
      createElement(QualitySummaryCards, {
        days: undefined,
        loading: true,
        failed: false,
      }),
    );
    expect(html).toContain("Loading…");
    expect(html).not.toContain("0 valid records");
    expect(html).not.toContain("0 days of batch results");
  });
  it("shows unavailable instead of zero records after the first response fails", () => {
    const html = renderToStaticMarkup(
      createElement(QualitySummaryCards, {
        days: undefined,
        loading: false,
        failed: true,
      }),
    );
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("0 valid records");
  });
  it("allows a successful empty result to show zero", () => {
    const html = renderToStaticMarkup(
      createElement(QualitySummaryCards, {
        days: [],
        loading: false,
        failed: false,
      }),
    );
    expect(html).toContain("0 valid records");
    expect(html).toContain("0 days of batch results");
    expect(html).not.toContain("Unavailable");
  });
  it("labels cached values after refresh failure", () => {
    const days = [
      {
        date: "2026-11-08",
        total: 10,
        valid: 8,
        duplicate: 1,
        outOfRange: 0,
        quarantined: 1,
      },
    ];
    const html = renderToStaticMarkup(
      createElement(QualitySummaryCards, {
        days,
        loading: false,
        failed: true,
      }),
    );
    expect(html).toContain("Last successful snapshot");
    expect(html).toContain("8 valid records");
    expect(html).toContain("80");
  });
});
