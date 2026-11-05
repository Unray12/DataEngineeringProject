/**
 * Backward-compatible entry point for the seeded dataset.
 *
 * The canonical implementation lives in `base.ts` (M3 Phase 0). Keeping this
 * file as a re-export means the older dashboard adapter keeps working while
 * M3 features import `base.ts` directly.
 */

export {
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  MOCK_NOW,
  MOCK_SEED,
  QUALITY_DAYS,
  alerts,
  deviceQuality,
  devices,
  farms,
  fields,
  getDeviceQuality,
  getDevices,
  getFarms,
  getFields,
  getIndicators,
  getLatest,
  getQualitySummary,
  getQualityTotals,
  qualityDays,
  series,
} from "./base";

export type { IndicatorRow, LatestMetric } from "./base";
