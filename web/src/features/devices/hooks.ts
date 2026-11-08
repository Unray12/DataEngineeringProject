"use client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  deviceSchema,
  envelopeSchema,
  farmSchema,
  fieldSchema,
  errorBodySchema,
} from "@/lib/api/schemas";
import { liveQueryOptions } from "./presentation";
export async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch {
    throw new Error("Device service could not be reached. Please retry.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorBodySchema.safeParse(body);
    throw new Error(
      error.success && error.data.error
        ? error.data.error
        : "Device data is unavailable. Please retry.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      "Device service returned an invalid response. Please retry.",
    );
  return parsed.data;
}
export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => read("/api/devices", envelopeSchema(z.array(deviceSchema))),
    ...liveQueryOptions(),
  });
}
export function useDeviceStatus(id: string) {
  return useQuery({
    queryKey: ["devices", id, "status"],
    enabled: Boolean(id),
    queryFn: () =>
      read(
        `/api/devices/${encodeURIComponent(id)}/status`,
        envelopeSchema(deviceSchema),
      ),
    ...liveQueryOptions(),
  });
}
export function useFarms() {
  return useQuery({
    queryKey: ["farms"],
    staleTime: 300_000,
    queryFn: () => read("/api/farms", envelopeSchema(z.array(farmSchema))),
  });
}
export function useFields(farm: string) {
  return useQuery({
    queryKey: ["fields", farm],
    enabled: Boolean(farm),
    staleTime: 300_000,
    queryFn: () =>
      read(
        `/api/farms/${encodeURIComponent(farm)}/fields`,
        envelopeSchema(z.array(fieldSchema)),
      ),
  });
}
