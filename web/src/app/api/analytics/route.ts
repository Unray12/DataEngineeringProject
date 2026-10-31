import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsData } from "@/lib/api/client";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const fieldId = request.nextUrl.searchParams.get("fieldId");
  if (!fieldId) return NextResponse.json({ error: "fieldId is required" }, { status: 400 });
  try {
    return NextResponse.json(await getAnalyticsData(fieldId));
  } catch {
    return NextResponse.json({ error: "Unable to load analytical data" }, { status: 502 });
  }
}
