import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});
async function client() {
  vi.stubEnv("DATA_MODE", "api");
  vi.stubEnv("API_BASE_URL", "http://backend");
  vi.stubEnv("API_KEY", "test-key");
  return import("./client");
}
it("injects the API key only in the server request and sets the default ten-second timeout", async () => {
  const { apiFetch } = await client();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ value: 1 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await apiFetch("/farms")).toEqual({ value: 1 });
  expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
    "x-api-key": "test-key",
  });
  expect(timeout).toHaveBeenCalledWith(10_000);
  timeout.mockRestore();
});
it("turns an abort into a typed timeout error", async () => {
  const { apiFetch } = await client();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url: unknown, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    ),
  );
  await expect(apiFetch("/farms", { timeoutMs: 10 })).rejects.toMatchObject({
    status: 504,
    code: "timeout",
  });
});
it("maps connectivity and malformed JSON failures", async () => {
  const { apiFetch } = await client();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  await expect(apiFetch("/farms")).rejects.toMatchObject({
    status: 502,
    code: "network_error",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("not json")),
  );
  await expect(apiFetch("/farms")).rejects.toMatchObject({
    status: 502,
    code: "invalid_payload",
  });
});
