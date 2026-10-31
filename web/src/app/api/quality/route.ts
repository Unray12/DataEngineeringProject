import { NextResponse } from "next/server";
import { getQualityData } from "@/lib/api/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getQualityData());
  } catch {
    return NextResponse.json({ error: "Unable to load quality data" }, { status: 502 });
  }
}
