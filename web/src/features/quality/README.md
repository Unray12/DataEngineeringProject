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
- Panels show snapshot retrieval time and state that this is not live; batch refresh time is unavailable in the current API.

## Endpoints

| Endpoint | Source | Cache | Notes |
|---|---|---|---|
| `GET /api/quality/summary?from=&to=` | Trino | `s-maxage=300` | Zod-validated date range (`YYYY-MM-DD`, `from <= to`) |
| `GET /api/quality/devices` | Trino | `s-maxage=300` | Per-device counts |

Only Trino-backed endpoints are used on this page. The browser never calls FastAPI.

## Data gaps in API mode

The current FastAPI `/quality/devices` endpoint exposes `device_id`, `total`, `valid`,
`flagged` and `last_batch_id`, but not the duplicate/out-of-range/quarantined
breakdown and not lineage. The adapter keeps the fields it has and sets the missing
ones to `null` or `[]`; the UI renders **“chưa có dữ liệu”** instead of inventing a
number. The daily summary still has the full breakdown.

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

## Loading and failure states

Summary cards show Loading or Unavailable until a successful response arrives.
A successful empty range can show zero; an unsuccessful response cannot. If a
refresh fails after data has loaded, cached totals are labelled as the last
successful snapshot. The chart and trace panel distinguish loading, failed
requests, and genuinely empty results. No backend contracts are changed.
