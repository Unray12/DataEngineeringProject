import { NextResponse } from "next/server";
import { getDevices } from "@/lib/api/devices";
import { isApiError } from "@/lib/api/errors";
export async function GET() {
  try {
    return NextResponse.json(await getDevices(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isApiError(error)
          ? error.message
          : "Device data is unavailable. Please retry.",
      },
      { status: isApiError(error) ? error.status : 502 },
    );
  }
}
