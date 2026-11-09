import type { Metadata } from "next";
import { FieldDetailPage } from "@/features/field-detail/field-detail-page";

type FieldPageProps = { params: Promise<{ id: string }> };

export const metadata: Metadata = {
  title: "Field · AgriMonitor",
  description: "Crop, targets, devices and recent alerts for one field.",
};

export default async function Page({ params }: FieldPageProps) {
  const { id } = await params;
  return <FieldDetailPage fieldId={id} />;
}
