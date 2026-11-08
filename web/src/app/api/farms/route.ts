import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/api/client";
import { farmSchema, envelopeSchema } from "@/lib/api/schemas";
import { z } from "zod";
export async function GET() {
  try {
    return NextResponse.json(
      envelopeSchema(z.array(farmSchema)).parse(
        (await getReferenceData()).farms,
      ),
      { headers: { "Cache-Control": "max-age=300" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Farm references are unavailable. Please retry." },
      { status: 502 },
    );
  }
}
