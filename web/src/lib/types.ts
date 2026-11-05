export type Metric = "soil_moisture" | "soil_temperature" | "air_temperature" | "air_humidity" | "rainfall";
export type Quality = "valid" | "suspect" | "invalid";
export type Status = "ok" | "attention" | "critical";
export type AlertType = "threshold" | "rate_of_change" | "device_outage" | "low_battery" | "poor_signal";
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "open" | "acknowledged" | "resolved";

export type Farm = { id: string; name: string; region: string; fieldCount: number; deviceCount: number; status: Status };
export type Field = {
  id: string;
  farmId: string;
  name: string;
  crop: string;
  growthStage: string;
  areaHa: number;
  status: Status;
  moisture: number;
  temperature: number;
  humidity: number;
  targets?: Partial<Record<Metric, { min: number; max: number }>>;
};
export type Device = { id: string; fieldId: string; name: string; status: "online" | "stale" | "offline"; lastSeen: string; batteryPct: number; rssi: number; gapCount24h: number };
export type Alert = {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  fieldId: string;
  deviceId?: string;
  metric?: Metric;
  status: AlertStatus;
  openedAt: string;
  message: string;
  observedValue?: number;
  thresholdValue?: number;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  note?: string;
};
export type Point = { t: string; value: number | null; quality?: Quality };
export type Series = { metric: Metric; unit: string; points: Point[]; gaps: { start: string; end: string }[] };
export type Envelope<T> = { data: T; meta: { asOf: string; source: "cassandra" | "trino" } };

export type QualityDay = {
  date: string;
  valid: number;
  duplicate: number;
  outOfRange: number;
  quarantined: number;
  total: number;
};

export type LineageEntry = {
  batchId: number;
  topic: string;
  partition: number;
  offset: number;
  ingestedAt: string;
};

export type DeviceQualityCounts = {
  valid: number;
  /**
   * `null` means the serving API does not expose this breakdown. The UI shows
   * "chưa có dữ liệu" instead of inventing a number.
   */
  duplicate: number | null;
  outOfRange: number | null;
  quarantined: number | null;
  total: number;
  flagged?: number | null;
};

export type DeviceQuality = {
  deviceId: string;
  counts: DeviceQualityCounts;
  lineage: LineageEntry[];
  lastBatchId?: number | null;
};
