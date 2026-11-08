import { z } from "zod";
import { getDevices } from "@/lib/api/devices";
import { handleRead } from "@/lib/api/handler";
export async function GET() {
  return handleRead(undefined, z.undefined(), getDevices);
}
