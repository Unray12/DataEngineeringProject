import { describe, expect, it } from "vitest";

describe("environment defaults", () => {
  it("parses the baseline defaults", async () => {
    const original = process.env.DATA_MODE;
    delete process.env.DATA_MODE;
    const { env } = await import("@/lib/env");
    expect(env.DATA_MODE).toBe("mock");
    if (original === undefined) delete process.env.DATA_MODE;
    else process.env.DATA_MODE = original;
  });
});
