import { env } from "@/lib/env";
import { DevicesWorkspace } from "@/features/devices/workspace";
export const dynamic = "force-dynamic";

export default function DevicesPage() {
  return <DevicesWorkspace preview={env.DATA_MODE === "mock"} />;
}
