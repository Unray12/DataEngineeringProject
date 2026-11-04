# AgriMonitor web app

The web app is a Next.js App Router frontend for the agriculture platform. It is intentionally a thin presentation layer: the browser calls only Next.js route handlers under `src/app/api`, and those handlers call FastAPI server-side when `DATA_MODE=api`.

## Local development

Install Bun, then run:

```sh
bun install
cp .env.example .env.local
bun run dev
```

The Docker Compose service runs with `DATA_MODE=api` and renders live data through FastAPI: near-real-time views use Cassandra-backed endpoints, while analytics and quality views use Trino over Iceberg/HDFS. The browser never connects to those systems directly. For standalone UI demos, `DATA_MODE=mock` remains available and deterministic. Set `DATA_MODE=api`, `API_BASE_URL` and (if needed) `API_KEY` to use the server-side FastAPI adapter.

The theme preference is stored in `localStorage`, so switching between Overview, Live monitor, Analytics and the other tabs preserves light or dark mode.

## M3: alerts and data quality

M3 adds two vertical slices:

- `/alerts` - filterable alert queue, detail drawer with a lifecycle timeline, and
  acknowledge/resolve actions with an optional note. The state machine is
  `open → acknowledged → resolved`; invalid transitions are rejected by the route
  handler with `409`. The browser calls only `GET /api/alerts` and
  `PATCH /api/alerts/{id}`.
- `/quality` - daily stacked quality chart, per-device quality table, lineage
  drill-down, traceability panel and a plain-language glossary. The browser calls
  only `GET /api/quality/summary` and `GET /api/quality/devices`.

Both pages use the seeded dataset in `src/lib/mock/base.ts` when `DATA_MODE=mock`.
The fixture table is in `src/lib/mock/README.md`. Feature notes and API-mode gaps are
in `src/features/alerts/README.md` and `src/features/quality/README.md`. In
`DATA_MODE=api`, missing lineage or per-device breakdown fields render
`chưa có dữ liệu` instead of a guessed value.

The M3 layout is responsive: below 1024 px the sidebar collapses into a six-item
bottom navigation, page headers and action groups wrap, stat cards become a 2 × 2
grid, filter fields go full width, tables scroll horizontally with the device
column pinned, and drawers/dialogs are full-width on phones. `globals.css` holds
the breakpoints; components only add small `hidden md:table-cell` classes for
columns that are available in the detail drawer instead.

## Vercel

Set the repository **Root Directory** to `web`. Preview deployments should use `DATA_MODE=mock`. Production can use mock mode for the project demo, or `api` mode only when FastAPI is available at a public HTTPS URL (for example through a Cloudflare Tunnel or hosted VM). `API_BASE_URL` and `API_KEY` remain server-only variables; do not prefix them with `NEXT_PUBLIC_`.

Build checks:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```
