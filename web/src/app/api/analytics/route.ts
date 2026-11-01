import { NextRequest, NextResponse } from "next/server";
import { getAnalytics } from "@/features/analytics/client";
import { analyticsQuerySchema } from "@/features/analytics/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const today = new Date().toISOString().slice(0, 10);
  const parsed = analyticsQuerySchema.safeParse({
    fieldId: request.nextUrl.searchParams.get("fieldId"),
    metric: request.nextUrl.searchParams.get("metric") ?? undefined,
    granularity: request.nextUrl.searchParams.get("granularity") ?? undefined,
    from: request.nextUrl.searchParams.get("from") ?? today,
    to: request.nextUrl.searchParams.get("to") ?? today,
  });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Invalid analytics filters" }, { status: 400 });
  try {
    return NextResponse.json(await getAnalytics(parsed.data));
  } catch {
    return NextResponse.json({ error: "Unable to load analytical data" }, { status: 502 });
  }
}
