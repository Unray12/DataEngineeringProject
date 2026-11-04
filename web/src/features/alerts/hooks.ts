"use client";

/**
 * Client-side data hooks for /alerts.
 *
 * The browser only talks to Next.js route handlers. Every response is parsed
 * with the Zod schemas from `lib/api/schemas.ts` before it reaches a component.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import {
  alertsEnvelopeSchema,
  alertEnvelopeSchema,
  dashboardReferenceSchema,
  errorBodySchema,
  type AlertsEnvelope,
} from "@/lib/api/schemas";
import type { Alert, AlertSeverity, AlertStatus, AlertType } from "@/lib/types";
import { applyAlertAction, type AlertAction } from "./state";

export type SortOrder = "newest" | "oldest" | "severity";

export type AlertFilterState = {
  status: AlertStatus | "all";
  severity: AlertSeverity | "all";
  type: AlertType | "all";
  farmId: string;
  fieldId: string;
  sort: SortOrder;
};

export const DEFAULT_ALERT_FILTERS: AlertFilterState = {
  status: "all",
  severity: "all",
  type: "all",
  farmId: "all",
  fieldId: "all",
  sort: "newest",
};

function filterQuery(state: AlertFilterState): Omit<AlertFilterState, "sort"> {
  return {
    status: state.status,
    severity: state.severity,
    type: state.type,
    farmId: state.farmId,
    fieldId: state.fieldId,
  };
}

function filterParams(filters: Omit<AlertFilterState, "sort">): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.severity !== "all") params.set("severity", filters.severity);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.farmId !== "all") params.set("farmId", filters.farmId);
  if (filters.fieldId !== "all") params.set("fieldId", filters.fieldId);
  return params;
}

function messageFrom(body: unknown, fallback: string): string {
  const parsed = errorBodySchema.safeParse(body);
  return parsed.success && parsed.data.error ? parsed.data.error : fallback;
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchAlerts(state: AlertFilterState): Promise<AlertsEnvelope> {
  const params = filterParams(filterQuery(state));
  const query = params.toString();
  const response = await fetch(`/api/alerts${query ? `?${query}` : ""}`, {
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFrom(body, "We could not load alerts."));
  }
  return alertsEnvelopeSchema.parse(body);
}

export function useAlerts(state: AlertFilterState) {
  const filters = filterQuery(state);
  return useQuery({
    queryKey: ["alerts", "list", filters],
    queryFn: () => fetchAlerts(state),
    staleTime: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export type AlertReference = {
  farms: Array<{ id: string; name: string }>;
  fields: Array<{ id: string; farmId: string; name: string; targets?: Record<string, { min: number; max: number }> }>;
  devices: Array<{ id: string; name: string; fieldId: string }>;
  asOf: string;
};

export async function fetchAlertReference(): Promise<AlertReference> {
  const response = await fetch("/api/dashboard", { cache: "no-store" });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFrom(body, "Reference data is unavailable."));
  }
  const parsed = dashboardReferenceSchema.parse(body);
  return {
    farms: parsed.farms.data.map((farm) => ({ id: farm.id, name: farm.name })),
    fields: parsed.fields.data.map((field) => ({
      id: field.id,
      farmId: field.farmId,
      name: field.name,
      targets: field.targets,
    })),
    devices: parsed.devices.data.map((device) => ({
      id: device.id,
      name: device.name,
      fieldId: device.fieldId,
    })),
    asOf: parsed.farms.meta.asOf,
  };
}

export function useAlertReference() {
  return useQuery({
    queryKey: ["dashboard", "reference"],
    queryFn: fetchAlertReference,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

type MutationVariables = {
  id: string;
  action: AlertAction;
  by: string;
  note?: string;
};

type MutationContext = {
  snapshots: Array<[QueryKey, AlertsEnvelope | undefined]>;
};

export async function patchAlert(variables: MutationVariables): Promise<Alert> {
  const response = await fetch(`/api/alerts/${encodeURIComponent(variables.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: variables.action,
      by: variables.by,
      note: variables.note?.trim() || undefined,
    }),
    cache: "no-store",
  });
  const body = await readBody(response);
  if (!response.ok) {
    throw new Error(messageFrom(body, "The alert could not be updated."));
  }
  return alertEnvelopeSchema.parse(body).data;
}

/**
 * Optimistic transition with rollback. Invalidates every alert list (including
 * M2's active-alerts key) and the dashboard payload, so `/` and `/live` see the
 * same state after an acknowledge or resolve.
 */
export function useAlertMutation() {
  const queryClient = useQueryClient();

  return useMutation<Alert, Error, MutationVariables, MutationContext>({
    mutationFn: patchAlert,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["alerts"] });
      const snapshots = queryClient.getQueriesData<AlertsEnvelope>({
        queryKey: ["alerts", "list"],
      });

      queryClient.setQueriesData<AlertsEnvelope>({ queryKey: ["alerts", "list"] }, (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((alert) => {
            if (alert.id !== variables.id) return alert;
            const result = applyAlertAction(alert, variables.action, variables.by, variables.note);
            return result.ok ? result.alert : alert;
          }),
        };
      });

      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      context?.snapshots.forEach(([key, value]) => {
        if (value !== undefined) queryClient.setQueryData(key, value);
      });
    },
    onSuccess: (updated) => {
      queryClient.setQueriesData<AlertsEnvelope>({ queryKey: ["alerts", "list"] }, (old) => {
        if (!old) return old;
        return { ...old, data: old.data.map((alert) => (alert.id === updated.id ? updated : alert)) };
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["alerts"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });
}
