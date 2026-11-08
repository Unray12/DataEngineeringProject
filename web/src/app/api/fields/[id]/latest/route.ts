import { resourceIdSchema } from "@/lib/api/schemas";
import { handleRead } from "@/lib/api/handler";
import { getLatest } from "@/lib/api/live";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRead((await params).id, resourceIdSchema, getLatest);
}
