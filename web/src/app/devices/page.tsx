import { Suspense } from "react";
import { env } from "@/lib/env";
import { DevicesWorkspace } from "@/features/devices/workspace";
export const dynamic = "force-dynamic";

export default function DevicesPage() {
  return (
    <Suspense fallback={<p role="status">Loading devices…</p>}>
      <DevicesWorkspace preview={env.DATA_MODE === "mock"} />
    </Suspense>
  );
}
