import { NextRequest, NextResponse } from "next/server";
import { isApiError } from "@/lib/api/errors";
import { getCompare } from "@/features/insights/server";
import { compareQuerySchema } from "@/features/insights/types";

export const runtime = "nodejs";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=0, s-maxage=120, stale-while-revalidate=300",
};

export async function GET(request: NextRequest) {
  const parsed = compareQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid comparison request", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { fieldIds, metric, from, to } = parsed.data;
    return NextResponse.json(await getCompare(fieldIds, metric, from, to), { headers: CACHE_HEADERS });
  } catch (error) {
    if (isApiError(error) && error.status === 503) {
      return NextResponse.json(
        { error: "The historical comparison is not ready yet. Run the batch refresh and try again." },
        { status: 503 },
      );
    }
    if (isApiError(error) && error.status === 400) {
      return NextResponse.json({ error: "One of the selected fields is unknown." }, { status: 400 });
    }
    return NextResponse.json({ error: "We could not load the comparison." }, { status: 502 });
  }
}
