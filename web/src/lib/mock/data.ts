import type { Alert, Device, Farm, Field, Series } from "@/lib/types";

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
export const farms: Farm[] = [
  { id: "farm-north", name: "North Valley Farm", region: "Da Lat", fieldCount: 5, deviceCount: 18, status: "attention" },
  { id: "farm-river", name: "Riverside Organics", region: "Can Tho", fieldCount: 4, deviceCount: 13, status: "ok" },
  { id: "farm-highland", name: "Highland Harvest", region: "Lam Dong", fieldCount: 3, deviceCount: 10, status: "critical" }
];
export const fields: Field[] = [
  { id: "field-n01", farmId: "farm-north", name: "N-01 Greenhouse", crop: "Tomato", growthStage: "Flowering", areaHa: 1.8, status: "ok", moisture: 41, temperature: 24.2, humidity: 68 },
  { id: "field-n02", farmId: "farm-north", name: "N-02 East Plot", crop: "Lettuce", growthStage: "Vegetative", areaHa: 2.4, status: "attention", moisture: 28, temperature: 26.1, humidity: 57 },
  { id: "field-n03", farmId: "farm-north", name: "N-03 Orchard", crop: "Avocado", growthStage: "Fruit set", areaHa: 4.1, status: "ok", moisture: 36, temperature: 23.8, humidity: 72 },
  { id: "field-r01", farmId: "farm-river", name: "R-01 Rice Basin", crop: "Rice", growthStage: "Tillering", areaHa: 8.2, status: "ok", moisture: 62, temperature: 29.4, humidity: 81 },
  { id: "field-r02", farmId: "farm-river", name: "R-02 Herbs", crop: "Basil", growthStage: "Harvest", areaHa: 1.2, status: "ok", moisture: 44, temperature: 27.1, humidity: 74 },
  { id: "field-h01", farmId: "farm-highland", name: "H-01 Coffee", crop: "Coffee", growthStage: "Cherry development", areaHa: 6.7, status: "critical", moisture: 19, temperature: 31.7, humidity: 49 }
];
export const devices: Device[] = fields.flatMap((field, fieldIndex) => Array.from({ length: fieldIndex % 3 + 3 }, (_, i) => ({
  id: `${field.id}-d${i + 1}`, fieldId: field.id, name: `Sensor ${field.name.split(" ")[0]}-${i + 1}`,
  status: field.id === "field-h01" && i === 0 ? "offline" : field.id === "field-n02" && i === 1 ? "stale" : "online",
  lastSeen: ago(field.id === "field-h01" && i === 0 ? 188 : field.id === "field-n02" && i === 1 ? 7 : 1),
  batteryPct: field.id === "field-r02" && i === 0 ? 16 : 71 + ((i * 7) % 25), rssi: -48 - i * 8, gapCount24h: field.id === "field-h01" ? 14 : i === 2 ? 3 : 0
})));
export const alerts: Alert[] = [
  { id: "a-1001", type: "threshold", severity: "critical", fieldId: "field-h01", status: "open", openedAt: ago(38), message: "Soil moisture is below the target range (19%). Irrigation may be needed." },
  { id: "a-1002", type: "device_outage", severity: "warning", fieldId: "field-h01", deviceId: "field-h01-d1", status: "open", openedAt: ago(188), message: "Sensor H-01-1 has not reported for 3 hours." },
  { id: "a-1003", type: "low_battery", severity: "warning", fieldId: "field-r02", deviceId: "field-r02-d1", status: "acknowledged", openedAt: ago(240), message: "Battery is at 16%. Schedule a battery replacement." },
  { id: "a-1004", type: "rate_of_change", severity: "info", fieldId: "field-n02", status: "resolved", openedAt: ago(420), message: "Air temperature changed quickly.", note: "Reviewed with operator." }
];
export function series(metric: Series["metric"]): Series {
  const base = metric === "soil_moisture" ? 38 : metric === "air_temperature" ? 25 : metric === "air_humidity" ? 65 : 24;
  return { metric, unit: metric === "soil_moisture" || metric === "air_humidity" ? "%" : "°C", gaps: [{ start: ago(185), end: ago(150) }], points: Array.from({ length: 49 }, (_, i) => {
    const value = base + Math.sin(i / 4) * (metric === "air_temperature" ? 4 : 7) + ((i * 17) % 5 - 2);
    return { t: ago((48 - i) * 30), value: i === 12 || i === 13 ? null : Number(value.toFixed(1)) };
  }) };
}
