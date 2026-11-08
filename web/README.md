# AgriMonitor web baseline

This Next.js App Router project is the shared baseline for the agricultural
monitoring frontend. Feature pages are intentionally placeholders so four
members can build independently. The repository uses Bun 1.4.4 for local,
container and CI parity.

## Setup

```sh
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev
```

The app runs at <http://localhost:3000>. `DATA_MODE=mock` is the default and
does not require FastAPI. `DATA_MODE=api` is reserved for feature work that
uses the server-side FastAPI adapter at `API_BASE_URL`; the browser must never
call FastAPI, Cassandra, HDFS, Iceberg, Trino or Kafka directly.

## Environment variables

See [.env.example](./.env.example). `API_KEY` and `APP_PASSWORD` are
server-only values. For Vercel, `API_BASE_URL` must be a publicly reachable
HTTPS endpoint, such as a Cloudflare Tunnel or hosted VM; `localhost` is not
reachable from Vercel.

## Project structure and ownership

```text
src/
├── app/
│   ├── page.tsx                 # Overview placeholder (M1)
│   ├── live/page.tsx            # Live monitor placeholder (M2)
│   ├── devices/page.tsx         # Device continuity/status (M2, implemented)
│   ├── alerts/page.tsx          # Alerts (M3, implemented)
│   ├── quality/page.tsx         # Quality (M3, implemented)
│   ├── analytics/page.tsx       # Analytics (M4, implemented)
│   ├── insights/page.tsx        # Insights placeholder (M1)
│   └── fields/[id]/page.tsx     # Field-detail placeholder (M1)
├── features/                    # Feature ownership notes
├── components/
│   ├── ui/                      # Generic shadcn primitives
│   └── shared/                  # Shared UI, owner M4
├── lib/
│   ├── api/                     # Shared adapter contracts, owner M2
│   ├── mock/                    # Seeded base dataset, owner M3
│   ├── env.ts                   # Zod environment validation
│   └── utils.ts                 # Generic helpers
└── types/                       # Shared contracts, owner M2
```

| Member | Requirements | Features |
|---|---|---|
| M1 | BR1, BR7 | overview, field-detail, insights |
| M2 | BR2, BR3 | live, devices |
| M3 | BR4, BR8 | alerts, quality |
| M4 | BR5, BR6 | analytics |

Every feature README records its owner, pages, endpoints and the previous
implementation reference. The previous implementation is archived at the
`archive/webapp-v1` tag and branch.

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

From 1024 px up, the sidebar can be collapsed to an icon rail with the button in
its header (`«` / `»`). The choice is stored under
`agrimonitor-sidebar-collapsed` and restored on the next visit; the main content
padding follows the rail so no state leaks into the mobile layout. `M3Shell` is a
temporary local shell and provides a "Skip to content" link, visible focus rings
for keyboard users, `aria-current` on the active navigation item, and respects
`prefers-reduced-motion`. It can be swapped for M4's shared shell without touching
feature code.

The previous one-page dashboard was removed when the app was reset to this
baseline (archived at `archive/webapp-v1`). `/`, `/live`, `/devices`, `/insights`
and `/fields/[id]` are M1/M2 placeholders; `/alerts` and `/quality` are implemented
by M3 and `/analytics` by M4.

## Vercel

Set the repository **Root Directory** to `web`. Use `DATA_MODE=mock` for
previews until a public HTTPS FastAPI backend is available. Production can use
`DATA_MODE=api` with server-only `API_BASE_URL` and `API_KEY`.

## Checks

```sh
bun run lint
bun run typecheck
bun run test
DATA_MODE=mock bun run build
```

## BR3 web-only scope

The Devices page uses existing read-only FastAPI contracts and main's shell.
Missing values are explicit; only the latest reported gap state is available.
Main's Quality workspace remains at `/quality`. This branch changes no database
schema, tables, streaming/batch processing or infrastructure. See
[device feature notes](src/features/devices/README.md) for limits and checks.
