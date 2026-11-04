import { NextRequest, NextResponse } from "next/server";
import { alertQuerySchema } from "@/lib/api/schemas";
import { getAlerts } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const parsed = alertQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid alert filter", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await getAlerts(parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "We could not load alerts. Try again shortly." },
      { status: 502 },
    );
  }
}
