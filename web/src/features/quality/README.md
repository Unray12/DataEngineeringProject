# Data quality

- Owner: M3
- Requirements: BR4
- Pages: `/quality`
- Endpoints: FastAPI Trino-backed quality summary and device quality contracts

Previous implementation (for reference only): git tag archive/webapp-v1, path `web/src/components/dashboard.tsx`

## What it does

- Daily stacked bar chart with valid, duplicate, out-of-range and quarantined records,
  a date-range selector and a table alternative for the same numbers.
- Per-device quality table (total, valid, breakdown, flagged, valid rate).
- Lineage drill-down: batch id, topic, partition, offset and ingest time.
- Traceability panel that picks a device and shows the path from sensor to batch to
  stream position to the gold quality table.
- Plain-language glossary for valid, duplicate, out-of-range, quarantined, suspect and
  lineage.
- Every panel shows `Data as of …` and states that this is not live.

## Endpoints

| Endpoint | Source | Cache | Notes |
|---|---|---|---|
| `GET /api/quality/summary?from=&to=` | Trino | `s-maxage=300` | Zod-validated date range (`YYYY-MM-DD`, `from <= to`) |
| `GET /api/quality/devices` | Trino | `s-maxage=300` | Per-device counts |

Only Trino-backed endpoints are used on this page. The browser never calls FastAPI.

## Per-device data in API mode

FastAPI `/quality/devices` returns, per device: `total`, `valid`, `flagged`,
`last_batch_id`, the `duplicate` and `out_of_range` counters (summed from
`ops.quality_counters`), the `quarantined` count (from `ops.quarantine`) and the
three newest `lineage` records (batch, topic, partition, offset, ingest time) from
`silver.sensor_readings`. The adapter reads all of them.

An older API that omits a field still works: the adapter sets the missing
breakdown to `null` and lineage to `[]`, and the UI renders **“chưa có dữ liệu”**
and shows the notice, instead of inventing a number.

## Pure helpers

`lineage.ts` contains `validRate`, `flaggedCount`, `missingBreakdown`,
`missingLineage`, `aggregateLineage`, `latestLineage`, `lineageLocation` and
`sortLineage`. They are unit-tested in `web/tests/quality-lineage.test.ts`.

## Tests

```sh
cd web
bun run test -- tests/quality-lineage.test.ts tests/quality-route.test.ts
```

(or `npm run test -- ...` when Bun is unavailable).

## Limitations

- Lineage is limited to the three seeded records per device; it is demo metadata,
  not a query against the real Iceberg metadata tables.
- The page is read-only. It does not repair or re-run quality jobs.
- The date range is computed in UTC to match the seed and the API.
