import { NextRequest, NextResponse } from "next/server";
import { isApiError } from "@/lib/api/errors";
import { getSummary } from "@/features/insights/server";
import { summaryQuerySchema } from "@/features/insights/types";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
};

export async function GET(request: NextRequest) {
  const parsed = summaryQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date range", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    return NextResponse.json(await getSummary(parsed.data.from, parsed.data.to), { headers: CACHE_HEADERS });
  } catch (error) {
    if (isApiError(error) && error.status === 503) {
      return NextResponse.json(
        { error: "The historical summaries are not ready yet. Run the batch refresh and try again." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "We could not load the summary." }, { status: 502 });
  }
}
