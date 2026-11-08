"use client";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { read } from "./read";
import {
  deviceSchema,
  farmSchema,
  fieldSchema,
  envelopeSchema,
  alertsEnvelopeSchema,
  latestEnvelopeSchema,
  seriesEnvelopeSchema,
  deviceContinuityEnvelopeSchema,
} from "./schemas";
import type { Metric } from "@/types";

export const liveQueryOptions = {
  staleTime: 0,
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: "always" as const,
  retry: false as const,
};
export function useFarms() {
  return useQuery({
    queryKey: ["farms"],
    staleTime: 300_000,
    queryFn: () => read("/api/farms", envelopeSchema(z.array(farmSchema))),
  });
}
export function useFields(farmId?: string) {
  return useQuery({
    queryKey: ["fields", farmId ?? ""],
    staleTime: 300_000,
    queryFn: async () => {
      if (farmId)
        return read(
          `/api/farms/${encodeURIComponent(farmId)}/fields`,
          envelopeSchema(z.array(fieldSchema)),
        );
      const farms = await read(
        "/api/farms",
        envelopeSchema(z.array(farmSchema)),
      );
      const groups = await Promise.all(
        farms.data.map((farm) =>
          read(
            `/api/farms/${encodeURIComponent(farm.id)}/fields`,
            envelopeSchema(z.array(fieldSchema)),
          ),
        ),
      );
      return {
        data: groups.flatMap((group) => group.data),
        meta: groups[0]?.meta ?? farms.meta,
      };
    },
  });
}
export function useDevices(fieldId?: string) {
  return useQuery({
    queryKey: ["devices"],
    queryFn: () => read("/api/devices", envelopeSchema(z.array(deviceSchema))),
    select: (result) => ({
      ...result,
      data: result.data.filter((row) => !fieldId || row.fieldId === fieldId),
    }),
    ...liveQueryOptions,
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
    ...liveQueryOptions,
  });
}
export function useDeviceContinuity(id: string) {
  return useQuery({
    queryKey: ["devices", id, "continuity"],
    enabled: Boolean(id),
    queryFn: () =>
      read(
        `/api/devices/${encodeURIComponent(id)}/continuity`,
        deviceContinuityEnvelopeSchema,
      ),
    ...liveQueryOptions,
  });
}
export function useLatest(fieldId: string) {
  return useQuery({
    queryKey: ["live", fieldId, "latest"],
    enabled: Boolean(fieldId),
    queryFn: () =>
      read(
        `/api/fields/${encodeURIComponent(fieldId)}/latest`,
        latestEnvelopeSchema,
      ),
    ...liveQueryOptions,
  });
}
export function useSeries(fieldId: string, metric: Metric) {
  return useQuery({
    queryKey: ["live", fieldId, "series", metric],
    enabled: Boolean(fieldId),
    queryFn: () =>
      read(
        `/api/fields/${encodeURIComponent(fieldId)}/series?hours=24&metric=${metric}`,
        seriesEnvelopeSchema,
      ),
    ...liveQueryOptions,
  });
}
export function useActiveAlerts(
  scope: { farmId?: string; fieldId?: string } = {},
) {
  // Shares M3's invalidation prefix; include acknowledged alerts until resolved.
  return useQuery({
    queryKey: ["alerts", "list", "active", scope],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (scope.farmId) params.set("farmId", scope.farmId);
      if (scope.fieldId) params.set("fieldId", scope.fieldId);
      return read(`/api/alerts?${params}`, alertsEnvelopeSchema);
    },
    select: (result) => ({
      ...result,
      data: result.data.filter((row) => row.status !== "resolved"),
    }),
    ...liveQueryOptions,
  });
}
