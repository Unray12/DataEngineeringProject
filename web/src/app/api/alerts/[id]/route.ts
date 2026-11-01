import { NextRequest, NextResponse } from "next/server";
import { transitionAlert } from "@/lib/api/client";
export const runtime = "nodejs";
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json() as { action?: string; note?: string };
  if (!["acknowledge", "resolve"].includes(body.action ?? "")) return NextResponse.json({ error: "Alert transition is not valid" }, { status: 400 });
  try {
    const alert = await transitionAlert(id, body.action as "acknowledge" | "resolve", body.note);
    return NextResponse.json({ data: alert, meta: { asOf: new Date().toISOString(), source: "cassandra" } });
  } catch {
    return NextResponse.json({ error: "Unable to update alert" }, { status: 502 });
  }
}
