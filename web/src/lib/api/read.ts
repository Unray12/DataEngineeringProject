import { z } from "zod";
import { errorBodySchema } from "./schemas";
export async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { cache: "no-store" });
  } catch {
    throw new Error("The data service could not be reached. Please retry.");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = errorBodySchema.safeParse(body);
    throw new Error(
      error.success && error.data.error
        ? error.data.error
        : "Data is unavailable. Please retry.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new Error(
      "The data service returned an invalid response. Please retry.",
    );
  return parsed.data;
}
