import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeviceQuality } from "@/lib/types";
import { DeviceQualityTable } from "@/features/quality/components/DeviceQualityTable";

const PLACEHOLDER = "chưa có dữ liệu";

describe("quality table placeholders", () => {
  it("renders the placeholder for missing breakdown and lineage data", () => {
    const row: DeviceQuality = {
      deviceId: "dev-n01-01",
      counts: {
        total: 400,
        valid: 396,
        duplicate: null,
        outOfRange: null,
        quarantined: null,
      },
      lineage: [],
    };

    const markup = renderToStaticMarkup(
      createElement(DeviceQualityTable, { rows: [row], onSelect: () => {} }),
    );

    // Three missing counts, the lineage cell and the explanatory note.
    expect(markup.split(PLACEHOLDER).length - 1).toBeGreaterThanOrEqual(5);
    expect(markup).toContain("Missing cells show");
    expect(markup).toContain("dev-n01-01");
    expect(markup).toContain("396");
  });
});
