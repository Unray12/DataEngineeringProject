# Field detail

- Owner: M1
- Requirements: BR1
- Page: `/fields/[id]`

## What it does
Crop, growth stage and area; current conditions; target ranges; the field's
devices with status; the five most recent alerts; an **Insights** section for
this field only (what changed per measurement vs the previous period, and its rank
among all fields); deep links to `/live` and `/analytics` pre-filtered with
`?field=<id>`, and a "Compare all fields" link to `/insights`. An unknown id shows
a "Field not found" state with a link back.

## Data
- `GET /api/overview` (Cassandra-backed) for the facts, devices and alerts.
- `GET /api/compare` (Trino-backed, via `useFieldInsights`) for the Insights section: every measurement for the chosen and the previous period, with all fields so the rank can be computed. Labelled "historical data, not live".
- No new endpoint.

## Known limitations
- `/live` and `/analytics` may ignore the `?field=` parameter until their owners read it.
- WEBAPP.md says `/insights` is "pre-filtered to the field"; we read that as this page's Insights section, because `/insights` is the all-fields summary.
- The Insights section sends 10 `/api/compare` calls (5 measurements × 2 periods); they are cached 120 s.
- Uses the temporary `M3Shell` until the shared shell lands.
