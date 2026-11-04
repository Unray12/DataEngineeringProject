import { NextResponse } from "next/server";
import { getDeviceQuality } from "@/lib/api/client";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
};

export async function GET() {
  try {
    return NextResponse.json(await getDeviceQuality(), { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "We could not load per-device data quality." },
      { status: 502 },
    );
  }
}
