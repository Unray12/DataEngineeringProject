import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiError } from "./errors";

/** Validate before calling the adapter; never expose upstream bodies or credentials. */
export async function handleRead<I, O>(
  input: unknown,
  schema: z.ZodType<I>,
  load: (input: I) => Promise<O>,
  reference = false,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await load(parsed.data), {
      headers: { "Cache-Control": reference ? "max-age=300" : "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          isApiError(error) && error.code !== "api_error"
            ? error.message
            : "Data is unavailable. Please retry.",
        code: isApiError(error) ? error.code : "invalid_payload",
      },
      {
        status: isApiError(error) ? error.status : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
