import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/api/client";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json(await getDashboardData()); }
  catch { return NextResponse.json({ error: "We could not load monitoring data. Try again shortly." }, { status: 502 }); }
}
