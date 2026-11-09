# Overview

- Owner: M1
- Requirements: BR1 (also feeds BR7)
- Page: `/`

## What it does
One view of every farm, field and device: summary cards (farms, fields, devices
online/stale/offline, open alerts), a farm → field list with the latest
conditions, and a "What needs attention" panel (top open alerts and devices that
are not reporting). Farm and field filters live in the URL (`?farm=&field=`).

## Data
- `GET /api/overview` → `getDashboardData()` (Cassandra-backed, `no-store`).
- The client polls every 30 s, pauses while the tab is hidden and refetches on focus.
- Every panel shows "Data as of …" and a warning after 90 s.

## Files
- `summary.ts` – pure, unit-tested helpers (scope, counts, attention lists, freshness)
- `hooks.ts` – `useOverview()`; `ui.tsx` – status chips, freshness label, data panel
  (also used by `field-detail` and `insights`)

## Known limitations
- Uses the temporary `M3Shell`/`M3QueryProvider` until the shared M4 shell lands.
- The filter is local to this page, not yet the global `useScope()` from M4.
- The sidebar has no "Insights" link (the nav lives in `m3-shell.tsx`, owned by M3); the page header links to it.
- Latest conditions come from the field record (moisture, air temperature, humidity); a value of 0 is shown as "—".

## Demo paths (BR1, BR7)
- **BR1 – centralised monitoring:** open `/` → summary cards show farms, fields, device status and open alerts → pick a farm or field → click a field → `/fields/<id>` shows its crop, current conditions, targets, devices and alerts.
- **BR7 – accessible insights:** open `/insights` → "What changed" and "Needs attention now" are plain sentences → change Period → pick a Measurement in the comparison → Export CSV. Open a field page → its Insights section describes that field and ranks it.
- Expected: every panel shows "Data as of …"; analytical panels say "historical data, not live".
