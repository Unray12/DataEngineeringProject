import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/api/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getReferenceData();
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch {
    return NextResponse.json(
      { error: "Reference data is unavailable. Try again shortly." },
      { status: 502 },
    );
  }
}
