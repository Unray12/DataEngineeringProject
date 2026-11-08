"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  alertSchema,
  deviceSchema,
  envelopeSchema,
  errorBodySchema,
  farmSchema,
  fieldSchema,
} from "@/lib/api/schemas";
import type { OverviewData } from "./summary";

const overviewSchema = z.object({
  farms: envelopeSchema(z.array(farmSchema)),
  fields: envelopeSchema(z.array(fieldSchema)),
  devices: envelopeSchema(z.array(deviceSchema)),
  alerts: envelopeSchema(z.array(alertSchema)),
});

export type Overview = { data: OverviewData; asOf: string };

async function fetchOverview(): Promise<Overview> {
  const response = await fetch("/api/overview", { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = errorBodySchema.safeParse(body);
    throw new Error(parsedError.success && parsedError.data.error ? parsedError.data.error : "Could not load the overview.");
  }
  const parsed = overviewSchema.safeParse(body);
  if (!parsed.success) throw new Error("The server returned data in an unexpected shape.");
  const { farms, fields, devices, alerts } = parsed.data;
  return {
    data: { farms: farms.data, fields: fields.data, devices: devices.data, alerts: alerts.data },
    asOf: farms.meta.asOf,
  };
}

/**
 * Live view: polls every 30 s, pauses while the tab is hidden and refetches
 * when the tab regains focus.
 */
export function useOverview() {
  return useQuery({
    queryKey: ["overview"],
    queryFn: fetchOverview,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
