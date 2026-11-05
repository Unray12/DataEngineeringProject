import type { Metadata } from "next";
import { AlertsPage } from "@/features/alerts/alerts-page";

export const metadata: Metadata = {
  title: "Alerts · AgriMonitor",
  description: "Alert lifecycle, response tracking and field context.",
};

export default function Page() {
  return <AlertsPage />;
}
