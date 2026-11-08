import { Suspense } from "react";
import { env } from "@/lib/env";
import { LiveWorkspace } from "@/features/live/workspace";
export const dynamic = "force-dynamic";
export default function LivePage() {
  return (
    <Suspense fallback={<p role="status">Loading live monitor…</p>}>
      <LiveWorkspace preview={env.DATA_MODE === "mock"} />
    </Suspense>
  );
}
