import { env } from "@/lib/env";
import { mockContinuity } from "@/features/devices/mock-continuity";
import { deviceContinuityEnvelopeSchema } from "./schemas";
import { apiFetch } from "./client";
import { liveEnvelope } from "./live";
import { ApiError, isApiError } from "./errors";

export async function getDeviceContinuity(id: string) {
  if (env.DATA_MODE === "mock")
    return deviceContinuityEnvelopeSchema.parse(
      liveEnvelope(mockContinuity(id)),
    );
  try {
    const raw = await apiFetch(
      `/devices/${encodeURIComponent(id)}/continuity`,
      { noStore: true },
    );
    const result = deviceContinuityEnvelopeSchema.parse(raw);
    if (
      result.data.deviceId !== id ||
      result.meta.source !== "cassandra" ||
      (result.data.availability === "available" &&
        result.data.readings.some((row) => row.deviceId !== id))
    )
      throw new ApiError(
        502,
        "Device history returned the wrong device or source.",
        "device_contract_mismatch",
      );
    return result;
  } catch (error) {
    if (!isApiError(error) || ![404, 405, 501].includes(error.status))
      throw error;
    return deviceContinuityEnvelopeSchema.parse(
      liveEnvelope({
        availability: "unavailable",
        deviceId: id,
        reason:
          "The device service does not expose gap history or recent readings yet.",
      }),
    );
  }
}
