import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Farms, fields, devices and alerts for the overview, field detail and insights pages (Cassandra-backed). */
export async function GET() {
  try {
    return NextResponse.json(await getDashboardData(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "We could not load the farm overview. Try again shortly." },
      { status: 502 },
    );
  }
}
