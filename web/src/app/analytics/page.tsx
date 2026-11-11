import type { Metadata } from "next";
import { AnalyticsPage } from "@/features/analytics/analytics-page";

export const metadata: Metadata = {
  title: "Analytics · AgriMonitor",
  description: "Management indicators, period comparison and field history.",
};

export default function Page() {
  return <AnalyticsPage />;
}
