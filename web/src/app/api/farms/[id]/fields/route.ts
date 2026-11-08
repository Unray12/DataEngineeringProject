import { NextResponse } from "next/server";
import { z } from "zod";
import { getReferenceData } from "@/lib/api/client";
import { fieldSchema, envelopeSchema } from "@/lib/api/schemas";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .safeParse((await params).id);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid farm ID" }, { status: 400 });
  try {
    const reference = await getReferenceData();
    if (!reference.farms.data.some((farm) => farm.id === parsed.data))
      return NextResponse.json(
        { error: "Farm was not found" },
        { status: 404 },
      );
    return NextResponse.json(
      envelopeSchema(z.array(fieldSchema)).parse({
        ...reference.fields,
        data: reference.fields.data.filter(
          (field) => field.farmId === parsed.data,
        ),
      }),
      { headers: { "Cache-Control": "max-age=300" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Field references are unavailable. Please retry." },
      { status: 502 },
    );
  }
}
