import type { Metadata } from "next";
import { OverviewPage } from "@/features/overview/overview-page";

export const metadata: Metadata = {
  title: "Overview · AgriMonitor",
  description: "All farms, fields and devices in one view.",
};

export default function Page() {
  return <OverviewPage />;
}
