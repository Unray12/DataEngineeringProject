import { getDeviceStatus } from "@/lib/api/devices";
import { resourceIdSchema } from "@/lib/api/schemas";
import { handleRead } from "@/lib/api/handler";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRead((await params).id, resourceIdSchema, getDeviceStatus);
}
