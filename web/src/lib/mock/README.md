# Seeded mock dataset (M3 Phase 0)

`base.ts` is the canonical demo dataset for the web app. It is deterministic:
the PRNG is `mulberry32` seeded per resource, so two imports of the same module
produce identical farms, fields, readings, alerts and quality counters.

- Seed: `MOCK_SEED = 20261104`
- Anchor: `MOCK_NOW` is captured once when the module loads, so the demo always
  looks current without changing the relative shape of the data.
- Scale: 3 farms, 12 fields, 42 devices, 288 points per 24-hour series, 90 daily
  quality buckets, 10 alerts.
- Timestamps are UTC ISO strings.

## Fixtures and deliberate anomalies

| Anomaly | Seed value | Where it is visible |
|---|---|---|
| Device outage with a gap | `field-h01-d1` last seen 188 minutes ago | `/devices` (offline), `/live` series gap, `/alerts` outage alert `a-1002` |
| Stale device | `field-n02-d2` last seen 7 minutes ago | `/devices` (stale), gap count 3 |
| Low battery | `field-r02-d1` battery 16% | `/alerts` low-battery alert `a-1003` (acknowledged) |
| Soil-moisture threshold breach | `field-h01` moisture 19% | `/alerts` threshold alert `a-1001` |
| Temperature spike marked suspect | one point in `field-h01` `air_temperature` series | `/live` chart (suspect point) and `/quality` glossary |
| Duplicates and quarantined counts | deterministic daily counters | `/quality` stacked chart and device table |
| Outage alert auto-resolves | `a-1007` resolved by `system` after `field-n04-d3` reported again | `/alerts` timeline |
| All lifecycle states | `open`, `acknowledged`, `resolved` | `/alerts` filters and stats |

`a-1002` stays open because `field-h01-d1` is still offline. `autoResolveOutage`
in `features/alerts/state.ts` models the backend rule for the tests.

## Pure functions

- `getFarms()`, `getFields(farmId?)`, `getDevices(fieldId?)`
- `getLatest(fieldId)` - latest value, unit, state (`low | ok | high`) and quality
- `getSeries(fieldId, metric)` - 24 h at 5-minute steps with real `null` gaps
- `getIndicators(fieldId, metric, days)` - daily aggregates for M4
- `getQualitySummary(from?, to?)`, `getDeviceQuality(deviceId?)`
- `getQualityTotals()` - fixture totals used by tests and the quality footer

## Test expectations

`web/tests/mock.test.ts` asserts determinism, the anomaly table above, and that
the sum of duplicate/quarantined counters in `/quality` matches the fixture.
`web/tests/schemas.test.ts` parses every generated payload with the Zod schemas
from `lib/api/schemas.ts`.
