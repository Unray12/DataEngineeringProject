import { NextResponse } from "next/server";
import { getAnalyticsFields } from "@/features/analytics/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getAnalyticsFields());
  } catch {
    return NextResponse.json({ error: "Unable to load field reference data" }, { status: 502 });
  }
}
