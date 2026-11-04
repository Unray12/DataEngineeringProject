import { NextRequest, NextResponse } from "next/server";
import { alertActionInputSchema } from "@/lib/api/schemas";
import { getAlert, transitionAlert } from "@/lib/api/client";
import { isApiError } from "@/lib/api/errors";
import { transition } from "@/features/alerts/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }

  const parsed = alertActionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid alert action", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const current = await getAlert(id);
    if (!current) {
      return NextResponse.json({ error: `Alert '${id}' was not found.` }, { status: 404 });
    }

    // Reject invalid lifecycle transitions before delegating to the adapter,
    // so the UI contract and the route handler enforce the same matrix.
    const check = transition(current.status, parsed.data.action);
    if (!check.ok) {
      return NextResponse.json(
        { error: check.message, code: check.code, allowed: check.allowed },
        { status: 409 },
      );
    }

    const alert = await transitionAlert(id, parsed.data.action, parsed.data.by, parsed.data.note);
    return NextResponse.json(
      {
        data: alert,
        meta: { asOf: new Date().toISOString(), source: "cassandra" },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "Unable to update the alert." }, { status: 502 });
  }
}
