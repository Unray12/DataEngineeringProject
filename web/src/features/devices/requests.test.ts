import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { read } from "./hooks";
afterEach(() => vi.unstubAllGlobals());
it("shows a friendly retry message for an HTML gateway failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    ),
  );
  await expect(read("/api/devices", z.array(z.string()))).rejects.toThrow(
    "Device data is unavailable. Please retry.",
  );
});
it("handles a JSON null failure without dereferencing it", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("null", { status: 503 })),
  );
  await expect(read("/api/devices", z.array(z.string()))).rejects.toThrow(
    "Device data is unavailable. Please retry.",
  );
});
it("rejects a successful but malformed payload with a friendly message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  await expect(read("/api/devices", z.array(z.string()))).rejects.toThrow(
    "invalid response. Please retry.",
  );
});
