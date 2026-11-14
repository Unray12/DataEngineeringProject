/**
 * Seeded mock dataset for the whole web app (M3 Phase 0, WEBAPP B-M3).
 *
 * Everything here is deterministic: a tiny PRNG (mulberry32) seeded per
 * resource means two runs of the same code produce the same farms, readings,
 * alerts and quality counters. Timestamps are anchored once per process so the
 * demo always looks "current".
 *
 * The intentionally broken fixtures are listed in `web/src/lib/mock/README.md`.
 */

import type {
  Alert,
  AlertSeverity,
  AlertStatus,
  AlertType,
  Device,
  DeviceQuality,
  Farm,
  Field,
  LineageEntry,
  Metric,
  Point,
  QualityDay,
  Series,
  Status,
} from "@/lib/types";

export const MOCK_SEED = 20_261_104;
export const MOCK_NOW = Date.now();
const MINUTE = 60_000;

const METRIC_BASELINE: Record<Metric, number> = {
  soil_moisture: 42,
  soil_temperature: 24,
  air_temperature: 27,
  air_humidity: 70,
  rainfall: 0.3,
};
const METRIC_AMPLITUDE: Record<Metric, number> = {
  soil_moisture: 6,
  soil_temperature: 1.2,
  air_temperature: 2.6,
  air_humidity: 5,
  rainfall: 0.4,
};
const METRIC_UNIT: Record<Metric, string> = {
  soil_moisture: "%",
  soil_temperature: "°C",
  air_temperature: "°C",
  air_humidity: "%",
  rainfall: "mm",
};
const METRIC_MIN: Record<Metric, number> = {
  soil_moisture: 0,
  soil_temperature: -10,
  air_temperature: -30,
  air_humidity: 0,
  rainfall: 0,
};
const METRIC_MAX: Record<Metric, number> = {
  soil_moisture: 100,
  soil_temperature: 50,
  air_temperature: 60,
  air_humidity: 100,
  rainfall: 200,
};

const CROP_TARGETS: Record<string, Partial<Record<Metric, { min: number; max: number }>>> = {
  TOMATO: { soil_moisture: { min: 35, max: 65 }, air_temperature: { min: 12, max: 36 } },
  LETTUCE: { soil_moisture: { min: 40, max: 70 }, air_temperature: { min: 10, max: 28 } },
  AVOCADO: { soil_moisture: { min: 30, max: 60 }, air_temperature: { min: 15, max: 32 } },
  MAIZE: { soil_moisture: { min: 25, max: 55 }, air_temperature: { min: 8, max: 35 } },
  RICE: { soil_moisture: { min: 30, max: 60 }, air_temperature: { min: 10, max: 38 } },
  BASIL: { soil_moisture: { min: 35, max: 65 }, air_temperature: { min: 15, max: 32 } },
  COFFEE: { soil_moisture: { min: 35, max: 70 }, air_temperature: { min: 14, max: 30 } },
};

type FieldSeed = {
  id: string;
  farmId: string;
  name: string;
  crop: string;
  growthStage: string;
  areaHa: number;
  moisture: number;
  temperature: number;
  humidity: number;
};

const FIELD_SEEDS: FieldSeed[] = [
  { id: "field-n01", farmId: "farm-north", name: "N-01 Greenhouse", crop: "TOMATO", growthStage: "Flowering", areaHa: 1.8, moisture: 41, temperature: 24.2, humidity: 68 },
  { id: "field-n02", farmId: "farm-north", name: "N-02 East Plot", crop: "LETTUCE", growthStage: "Vegetative", areaHa: 2.4, moisture: 28, temperature: 26.1, humidity: 57 },
  { id: "field-n03", farmId: "farm-north", name: "N-03 Orchard", crop: "AVOCADO", growthStage: "Fruit set", areaHa: 4.1, moisture: 36, temperature: 23.8, humidity: 72 },
  { id: "field-n04", farmId: "farm-north", name: "N-04 North Maize", crop: "MAIZE", growthStage: "Tasseling", areaHa: 1.6, moisture: 44, temperature: 27.4, humidity: 66 },
  { id: "field-r01", farmId: "farm-river", name: "R-01 Rice Basin", crop: "RICE", growthStage: "Tillering", areaHa: 8.2, moisture: 62, temperature: 29.4, humidity: 81 },
  { id: "field-r02", farmId: "farm-river", name: "R-02 Herbs", crop: "BASIL", growthStage: "Harvest", areaHa: 1.2, moisture: 44, temperature: 27.1, humidity: 74 },
  { id: "field-r03", farmId: "farm-river", name: "R-03 River Paddy", crop: "RICE", growthStage: "Panicle initiation", areaHa: 6.4, moisture: 57, temperature: 28.7, humidity: 78 },
  { id: "field-r04", farmId: "farm-river", name: "R-04 Sandy Maize", crop: "MAIZE", growthStage: "Grain fill", areaHa: 2.1, moisture: 22, temperature: 24.9, humidity: 61 },
  { id: "field-h01", farmId: "farm-highland", name: "H-01 Coffee Slope", crop: "COFFEE", growthStage: "Cherry development", areaHa: 6.7, moisture: 19, temperature: 31.7, humidity: 49 },
  { id: "field-h02", farmId: "farm-highland", name: "H-02 Hill Coffee", crop: "COFFEE", growthStage: "Flowering", areaHa: 5.2, moisture: 37, temperature: 26.8, humidity: 70 },
  { id: "field-h03", farmId: "farm-highland", name: "H-03 Shade Tomato", crop: "TOMATO", growthStage: "Fruiting", areaHa: 1.4, moisture: 33, temperature: 33.2, humidity: 58 },
  { id: "field-h04", farmId: "farm-highland", name: "H-04 Valley Paddy", crop: "RICE", growthStage: "Seedling", areaHa: 3.8, moisture: 48, temperature: 28.1, humidity: 76 },
];

const CROP_NAMES: Record<string, string> = {
  TOMATO: "Tomato",
  LETTUCE: "Lettuce",
  AVOCADO: "Avocado",
  MAIZE: "Maize",
  RICE: "Rice",
  BASIL: "Basil",
  COFFEE: "Coffee",
};

// Deterministic pseudo-random helpers

/** mulberry32: 32-bit PRNG, good enough for demo data and stable across runs. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function rngFor(...parts: Array<string | number>): () => number {
  return mulberry32((MOCK_SEED ^ hashString(parts.join("|"))) >>> 0);
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  const v = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function iso(msAgo: number): string {
  return new Date(MOCK_NOW - msAgo).toISOString();
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// Farms, fields and devices

function fieldStatus(field: FieldSeed): Status {
  const { moisture, temperature } = field;
  if (moisture < 25 || temperature > 35) return "critical";
  if (moisture < 30 || temperature > 32) return "attention";
  return "ok";
}

export const fields: Field[] = FIELD_SEEDS.map((seed) => ({
  id: seed.id,
  farmId: seed.farmId,
  name: seed.name,
  crop: CROP_NAMES[seed.crop] ?? seed.crop,
  growthStage: seed.growthStage,
  areaHa: seed.areaHa,
  status: fieldStatus(seed),
  moisture: seed.moisture,
  temperature: seed.temperature,
  humidity: seed.humidity,
  targets: CROP_TARGETS[seed.crop],
}));

const FARM_SEEDS = [
  { id: "farm-north", name: "North Valley Farm", region: "Da Lat" },
  { id: "farm-river", name: "Riverside Organics", region: "Can Tho" },
  { id: "farm-highland", name: "Highland Harvest", region: "Lam Dong" },
];

function worstStatus(statuses: Status[]): Status {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("attention")) return "attention";
  return "ok";
}

export const devices: Device[] = fields.flatMap((field, fieldIndex) => {
  const count = 3 + (fieldIndex % 2);
  return Array.from({ length: count }, (_, deviceIndex) => {
    const id = `${field.id}-d${deviceIndex + 1}`;
    const offline = id === "field-h01-d1";
    const stale = id === "field-n02-d2";
    const battery = id === "field-r02-d1" ? 16 : 71 + ((deviceIndex * 7 + fieldIndex) % 25);
    const signal = id === "field-h02-d2" ? 0.22 : 0.68 + ((deviceIndex * 11 + fieldIndex) % 30) / 100;
    return {
      id,
      fieldId: field.id,
      name: `Sensor ${field.name.split(" ")[0]}-${deviceIndex + 1}`,
      status: offline ? "offline" : stale ? "stale" : "online",
      lastSeen: iso((offline ? 188 : stale ? 7 : 1) * MINUTE),
      batteryPct: battery,
      rssi: signal,
      gapCount24h: offline ? 14 : stale ? 3 : 0,
    } satisfies Device;
  });
});

export const farms: Farm[] = FARM_SEEDS.map((seed) => {
  const farmFields = fields.filter((field) => field.farmId === seed.id);
  const farmFieldIds = new Set(farmFields.map((field) => field.id));
  return {
    id: seed.id,
    name: seed.name,
    region: seed.region,
    fieldCount: farmFields.length,
    deviceCount: devices.filter((device) => farmFieldIds.has(device.fieldId)).length,
    status: worstStatus(farmFields.map((field) => field.status)),
  };
});

export function getFarms(): Farm[] {
  return farms.map((farm) => ({ ...farm }));
}

export function getFields(farmId?: string): Field[] {
  return fields.filter((field) => !farmId || field.farmId === farmId).map((field) => ({ ...field }));
}

export function getDevices(fieldId?: string): Device[] {
  return devices.filter((device) => !fieldId || device.fieldId === fieldId).map((device) => ({ ...device }));
}

// Latest values and 24-hour series

const METRIC_CYCLE: Metric[] = ["soil_moisture", "soil_temperature", "air_temperature", "air_humidity", "rainfall"];

export type LatestMetric = { metric: Metric; value: number; unit: string; measuredAt: string; quality: "valid" | "suspect" | "invalid"; state: "low" | "ok" | "high" };

export function getLatest(fieldId: string): LatestMetric[] {
  const field = fields.find((item) => item.id === fieldId);
  if (!field) return [];
  return METRIC_CYCLE.map((metric) => {
    const random = rngFor("latest", fieldId, metric);
    const base = metric === "soil_moisture" ? field.moisture : metric === "air_temperature" ? field.temperature : metric === "air_humidity" ? field.humidity : METRIC_BASELINE[metric];
    const target = field.targets?.[metric];
    const value = round(base + gaussian(random) * 0.4, 1);
    const state = target ? (value < target.min ? "low" : value > target.max ? "high" : "ok") : "ok";
    const suspect = fieldId === "field-h01" && metric === "air_temperature";
    return {
      metric,
      value,
      unit: METRIC_UNIT[metric],
      measuredAt: iso(2 * MINUTE),
      quality: suspect ? "suspect" : "valid",
      state,
    };
  });
}

/** Series point count: 24 h at one reading every 5 minutes. */
export const SERIES_POINTS = 288;
const SERIES_STEP_MS = 5 * MINUTE;

function gapWindow(fieldId: string, metric: Metric): { start: number; end: number } | null {
  // field-h01-d1 stopped reporting 188 minutes ago; show the outage as a real
  // gap (null points + gaps[]) in its two metrics instead of interpolating.
  if (fieldId === "field-h01" && (metric === "soil_moisture" || metric === "soil_temperature")) {
    return { start: MOCK_NOW - 188 * MINUTE, end: MOCK_NOW - 150 * MINUTE };
  }
  return null;
}

export function getSeries(fieldId: string, metric: Metric): Series {
  const field = fields.find((item) => item.id === fieldId) ?? fields[0];
  const random = rngFor("series", field.id, metric);
  const baseline =
    metric === "soil_moisture"
      ? field.moisture
      : metric === "air_temperature"
        ? field.temperature
        : metric === "air_humidity"
          ? field.humidity
          : METRIC_BASELINE[metric];
  const gap = gapWindow(field.id, metric);
  const points: Point[] = [];

  for (let index = 0; index < SERIES_POINTS; index += 1) {
    const timestamp = MOCK_NOW - (SERIES_POINTS - 1 - index) * SERIES_STEP_MS;
    const wave = Math.sin(index / 18 + hashString(field.id) % 7) * METRIC_AMPLITUDE[metric];
    const value = Math.min(
      METRIC_MAX[metric],
      Math.max(METRIC_MIN[metric], baseline + wave + gaussian(random) * METRIC_AMPLITUDE[metric] * 0.25),
    );
    const inGap = gap !== null && timestamp >= gap.start && timestamp <= gap.end;
    const suspect = field.id === "field-h01" && metric === "air_temperature" && index === 12;
    points.push({
      t: new Date(timestamp).toISOString(),
      value: inGap ? null : round(value, metric === "rainfall" ? 2 : 1),
      quality: inGap ? "invalid" : suspect ? "suspect" : "valid",
    });
  }

  return {
    metric,
    unit: METRIC_UNIT[metric],
    points,
    gaps: gap ? [{ start: new Date(gap.start).toISOString(), end: new Date(gap.end).toISOString() }] : [],
  };
}

/** Backward-compatible helper used by the existing mock adapter. */
export function series(metric: Metric, fieldId = "field-n01"): Series {
  return getSeries(fieldId, metric);
}

export type IndicatorRow = {
  bucket: string;
  metric: Metric;
  min: number;
  max: number;
  avg: number;
  count: number;
  timeInRangePct: number;
  hoursBelowTarget: number;
};

/** Daily analytical aggregates for the last N days (shared with M4). */
export function getIndicators(fieldId: string, metric: Metric, days = 7): IndicatorRow[] {
  const field = fields.find((item) => item.id === fieldId) ?? fields[0];
  const rows: IndicatorRow[] = [];
  const target = field.targets?.[metric];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const random = rngFor("indicator", field.id, metric, offset);
    const center = METRIC_BASELINE[metric] + gaussian(random) * 2;
    const min = round(center - Math.abs(gaussian(random)) * 3, 1);
    const max = round(center + Math.abs(gaussian(random)) * 3, 1);
    const avg = round((min + max) / 2, 1);
    const inRange = target ? avg >= target.min && avg <= target.max : true;
    rows.push({
      bucket: new Date(MOCK_NOW - offset * 24 * 60 * MINUTE).toISOString().slice(0, 10),
      metric,
      min,
      max,
      avg,
      count: 288 + (offset % 5),
      timeInRangePct: inRange ? 92 + (offset % 8) : 54 + (offset % 20),
      hoursBelowTarget: target && avg < target.min ? 3 + (offset % 6) : 0,
    });
  }
  return rows;
}

// Alerts (all three lifecycle states plus every severity/type)

function alert(row: Omit<Alert, "openedAt"> & { minutesAgo: number }): Alert {
  const { minutesAgo, ...rest } = row;
  return { ...rest, openedAt: iso(minutesAgo * MINUTE) };
}

export const alerts: Alert[] = [
  alert({
    id: "a-1001",
    type: "threshold",
    severity: "critical",
    fieldId: "field-h01",
    deviceId: "field-h01-d1",
    metric: "soil_moisture",
    status: "open",
    minutesAgo: 38,
    observedValue: 19,
    thresholdValue: 40,
    message: "Soil moisture is below the target range (19%). Irrigation may be needed.",
  }),
  alert({
    id: "a-1002",
    type: "device_outage",
    severity: "warning",
    fieldId: "field-h01",
    deviceId: "field-h01-d1",
    status: "open",
    minutesAgo: 188,
    observedValue: 188,
    thresholdValue: 20,
    message: "Sensor H-01-1 has not reported for 188 minutes.",
  }),
  alert({
    id: "a-1003",
    type: "low_battery",
    severity: "warning",
    fieldId: "field-r02",
    deviceId: "field-r02-d1",
    status: "acknowledged",
    minutesAgo: 240,
    observedValue: 16,
    thresholdValue: 20,
    message: "Battery is at 16%. Schedule a battery replacement.",
    acknowledgedAt: iso(220 * MINUTE),
    acknowledgedBy: "Linh Nguyen",
    note: "Replacement battery ordered for the next visit.",
  }),
  alert({
    id: "a-1004",
    type: "rate_of_change",
    severity: "info",
    fieldId: "field-n02",
    deviceId: "field-n02-d1",
    metric: "air_temperature",
    status: "resolved",
    minutesAgo: 420,
    observedValue: 9.4,
    thresholdValue: 5,
    message: "Air temperature changed faster than the configured step.",
    acknowledgedAt: iso(410 * MINUTE),
    acknowledgedBy: "system",
    resolvedAt: iso(400 * MINUTE),
    resolvedBy: "system",
    note: "Auto-resolved: the next readings were back inside the target range.",
  }),
  alert({
    id: "a-1005",
    type: "threshold",
    severity: "warning",
    fieldId: "field-r01",
    deviceId: "field-r01-d1",
    metric: "soil_moisture",
    status: "open",
    minutesAgo: 95,
    observedValue: 28.5,
    thresholdValue: 30,
    message: "Soil moisture is slightly below the target range (28.5%).",
  }),
  alert({
    id: "a-1006",
    type: "threshold",
    severity: "warning",
    fieldId: "field-h03",
    deviceId: "field-h03-d2",
    metric: "air_temperature",
    status: "acknowledged",
    minutesAgo: 150,
    observedValue: 33.2,
    thresholdValue: 32,
    message: "Air temperature is above the target range (33.2°C).",
    acknowledgedAt: iso(120 * MINUTE),
    acknowledgedBy: "Minh Tran",
  }),
  alert({
    id: "a-1007",
    type: "device_outage",
    severity: "warning",
    fieldId: "field-n04",
    deviceId: "field-n04-d3",
    status: "resolved",
    minutesAgo: 600,
    observedValue: 95,
    thresholdValue: 20,
    message: "Sensor N-04-3 stopped reporting for 95 minutes.",
    acknowledgedAt: iso(580 * MINUTE),
    acknowledgedBy: "system",
    resolvedAt: iso(540 * MINUTE),
    resolvedBy: "system",
    note: "Auto-resolved when the device reported again.",
  }),
  alert({
    id: "a-1008",
    type: "poor_signal",
    severity: "info",
    fieldId: "field-h02",
    deviceId: "field-h02-d2",
    status: "open",
    minutesAgo: 60,
    observedValue: 0.22,
    thresholdValue: 0.3,
    message: "Signal quality is poor on sensor H-02-2 (0.22).",
  }),
  alert({
    id: "a-1009",
    type: "threshold",
    severity: "critical",
    fieldId: "field-r04",
    deviceId: "field-r04-d1",
    metric: "soil_moisture",
    status: "open",
    minutesAgo: 15,
    observedValue: 22,
    thresholdValue: 28,
    message: "Soil moisture is below the target range (22%).",
  }),
  alert({
    id: "a-1010",
    type: "low_battery",
    severity: "warning",
    fieldId: "field-n03",
    deviceId: "field-n03-d3",
    status: "open",
    minutesAgo: 300,
    observedValue: 18,
    thresholdValue: 20,
    message: "Battery is at 18%. Plan a replacement this week.",
  }),
];

// Quality: 90 daily counters + per-device lineage

export const QUALITY_DAYS = 90;

function dayIso(offset: number): string {
  const date = new Date(MOCK_NOW - offset * 24 * 60 * MINUTE);
  return date.toISOString().slice(0, 10);
}

export const qualityDays: QualityDay[] = Array.from({ length: QUALITY_DAYS }, (_, index) => {
  const offset = QUALITY_DAYS - 1 - index;
  const valid = 720 + ((index * 13) % 97);
  const duplicate = index % 4 === 0 ? 7 : index % 3;
  const outOfRange = index % 9 === 0 ? 5 : index % 5 === 0 ? 2 : 0;
  const quarantined = index % 7 === 0 ? 6 : index % 2;
  return {
    date: dayIso(offset),
    valid,
    duplicate,
    outOfRange,
    quarantined,
    total: valid + duplicate + outOfRange + quarantined,
  };
});

export const QUALITY_TOTALS = qualityDays.reduce(
  (totals, day) => ({
    valid: totals.valid + day.valid,
    duplicate: totals.duplicate + day.duplicate,
    outOfRange: totals.outOfRange + day.outOfRange,
    quarantined: totals.quarantined + day.quarantined,
    total: totals.total + day.total,
  }),
  { valid: 0, duplicate: 0, outOfRange: 0, quarantined: 0, total: 0 },
);

export function getQualitySummary(from?: string, to?: string): QualityDay[] {
  return qualityDays
    .filter((day) => (!from || day.date >= from) && (!to || day.date <= to))
    .map((day) => ({ ...day }));
}

function lineageFor(deviceIndex: number): LineageEntry[] {
  const random = rngFor("lineage", deviceIndex);
  return Array.from({ length: 3 }, (_, offset) => ({
    batchId: 1_200 + deviceIndex,
    topic: "sensor.readings.v1",
    partition: deviceIndex % 3,
    offset: 58_000 + deviceIndex * 97 + offset * 37 + Math.floor(random() * 9),
    ingestedAt: iso((offset + 1) * 5 * MINUTE),
  }));
}

export const deviceQuality: DeviceQuality[] = devices.map((device, index) => {
  const counts = {
    valid: 1_200 + ((index * 37) % 400),
    duplicate: index % 5,
    outOfRange: index % 7 === 0 ? 3 : 0,
    quarantined: index % 9 === 0 ? 2 : 0,
    total: 0,
  };
  counts.total = counts.valid + counts.duplicate + counts.outOfRange + counts.quarantined;
  return { deviceId: device.id, counts, lineage: lineageFor(index) };
});

export function getDeviceQuality(deviceId?: string): DeviceQuality[] {
  return deviceQuality
    .filter((row) => !deviceId || row.deviceId === deviceId)
    .map((row) => ({ ...row, counts: { ...row.counts }, lineage: row.lineage.map((entry) => ({ ...entry })) }));
}

/** All quality fixture totals, used by tests and the UI footer. */
export function getQualityTotals() {
  return { ...QUALITY_TOTALS };
}

export const ALERT_STATUSES: AlertStatus[] = ["open", "acknowledged", "resolved"];
export const ALERT_SEVERITIES: AlertSeverity[] = ["info", "warning", "critical"];
export const ALERT_TYPES: AlertType[] = ["threshold", "rate_of_change", "device_outage", "low_battery", "poor_signal"];
