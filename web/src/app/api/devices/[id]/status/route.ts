import { NextResponse } from "next/server";
import { z } from "zod";
import { getDeviceStatus } from "@/lib/api/devices";
import { isApiError } from "@/lib/api/errors";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .safeParse((await params).id);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid device ID" }, { status: 400 });
  try {
    return NextResponse.json(await getDeviceStatus(parsed.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: isApiError(error)
          ? error.message
          : "Device status is unavailable. Please retry.",
      },
      { status: isApiError(error) ? error.status : 502 },
    );
  }
}
