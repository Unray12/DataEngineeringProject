import type { Metadata } from "next";
import { InsightsPage } from "@/features/insights/insights-page";

export const metadata: Metadata = {
  title: "Insights · AgriMonitor",
  description: "Plain-language summaries and field comparison.",
};

export default function Page() {
  return <InsightsPage />;
}
