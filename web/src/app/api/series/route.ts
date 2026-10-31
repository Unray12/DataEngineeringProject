import { NextRequest, NextResponse } from "next/server";
import { getSeries } from "@/lib/api/client";
import type { Metric } from "@/lib/types";
export const runtime = "nodejs";
const allowed: Metric[] = ["soil_moisture", "soil_temperature", "air_temperature", "air_humidity", "rainfall"];
export async function GET(request: NextRequest) {
  const metric = request.nextUrl.searchParams.get("metric") as Metric | null;
  if (!metric || !allowed.includes(metric)) return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  return NextResponse.json(await getSeries(metric, request.nextUrl.searchParams.get("fieldId") ?? "field-n01"));
}
