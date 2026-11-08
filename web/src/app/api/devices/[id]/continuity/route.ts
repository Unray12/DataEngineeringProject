import { resourceIdSchema } from "@/lib/api/schemas";
import { handleRead } from "@/lib/api/handler";
import { getDeviceContinuity } from "@/lib/api/continuity";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRead((await params).id, resourceIdSchema, getDeviceContinuity);
}
