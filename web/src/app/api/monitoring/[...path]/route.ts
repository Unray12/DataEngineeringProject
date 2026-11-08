import { NextRequest, NextResponse } from "next/server";
import { monitoring } from "@/features/monitoring/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = (await params).path.join("/");
  if (!/^(devices|devices\/[a-zA-Z0-9_-]+\/status)$/.test(path))
    return NextResponse.json(
      { error: "Unknown monitoring route" },
      { status: 404 },
    );
  try {
    return NextResponse.json(await monitoring(path));
  } catch {
    return NextResponse.json(
      {
        error:
          "Monitoring data is unavailable. Retry when the service is ready.",
      },
      { status: 503 },
    );
  }
}
