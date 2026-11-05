import { NextRequest, NextResponse } from "next/server";
import { qualityRangeSchema } from "@/lib/api/schemas";
import { getQualitySummary } from "@/lib/api/client";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
};

export async function GET(request: NextRequest) {
  const parsed = qualityRangeSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid quality date range", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await getQualitySummary(parsed.data.from, parsed.data.to);
    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "We could not load the data-quality summary." },
      { status: 502 },
    );
  }
}
