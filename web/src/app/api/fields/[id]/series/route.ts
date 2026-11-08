import { z } from "zod";
import { resourceIdSchema, seriesQuerySchema } from "@/lib/api/schemas";
import { handleRead } from "@/lib/api/handler";
import { getSeries } from "@/lib/api/live";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRead(
    {
      ...Object.fromEntries(new URL(request.url).searchParams),
      id: (await params).id,
    },
    z.object({ id: resourceIdSchema }).merge(seriesQuerySchema),
    ({ id, metric, hours }) => getSeries(id, metric, hours),
  );
}
