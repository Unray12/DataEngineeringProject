import type { Metadata } from "next";
import { QualityPage } from "@/features/quality/quality-page";

export const metadata: Metadata = {
  title: "Data quality · AgriMonitor",
  description: "Daily quality counts, per-device quality and lineage.",
};

export default function Page() {
  return <QualityPage />;
}
