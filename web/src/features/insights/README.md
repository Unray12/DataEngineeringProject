# Insights

- Owner: M1
- Requirements: BR7
- Page: `/insights`

## What it does
Plain-language "what changed" sentences (current period vs the previous period
of the same length), "needs attention now", summary cards, and a field
comparison: ranked table plus one range bar per field. CSV export of the table
(text cells that look like spreadsheet formulas are neutralised).

## Data
- `GET /api/summary?from=&to=` → FastAPI `/summary` (Trino-backed)
- `GET /api/compare?fieldIds=&metric=&from=&to=` → FastAPI `/compare` (Trino-backed)
- The "Needs attention now" list uses the Cassandra-backed overview data. It is text only, never mixed into a chart.
- Cached 120 s on the server; no polling. Every panel is labelled "historical data, not live".

## Scope
`/insights` is the farm-wide page: every figure covers all fields, except the comparison panel, which has its own Measurement choice. Insights for a single field live on `/fields/[id]`.

## Files
- `narrative.ts` – pure sentence builders (`describeChange`, `describeComparison`, `attentionSentences`)
- `server.ts` – mock/api adapter; `types.ts` – Zod schemas; `range.ts`, `csv.ts` – pure helpers

## Known limitations
- `describeChange` lives here because M4's `lib/format.ts` is not merged yet; switch when it is.
- The FastAPI `/compare` has no time-in-range, so that column shows "—" in api mode.
- Mock aggregates come from the shared seeded indicators, which use one baseline for all fields, so mock fields look alike. The shared mock can produce negative rainfall (owner: M3); `server.ts` caps rainfall at 0 in mock mode.
