import { describe, expect, it } from "vitest";
import { toCsv } from "../src/features/insights/csv";

/** One cell, as it appears in the file body. */
const csvCell = (value: string | number) => toCsv(["h"], [[value]]).split("\r\n")[1];
import { lastDays, previousRange } from "../src/features/insights/range";

describe("csv", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell('North, "A"')).toBe('"North, ""A"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("neutralises spreadsheet formulas in text but keeps numbers numeric", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell(-3.5)).toBe("-3.5");
  });

  it("writes empty cells for missing values", () => {
    expect(toCsv(["a", "b"], [[1, null], [undefined, "x"]])).toBe("a,b\r\n1,\r\n,x");
  });
});

describe("date ranges", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");

  it("builds an inclusive window ending today", () => {
    expect(lastDays(7, now)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
  });

  it("builds the previous period of the same length", () => {
    expect(previousRange({ from: "2026-11-01", to: "2026-11-07" })).toEqual({ from: "2026-10-25", to: "2026-10-31" });
  });

  it("never returns a window shorter than one day", () => {
    expect(lastDays(0, now)).toEqual({ from: "2026-11-07", to: "2026-11-07" });
  });
});
