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
│   ├── page.tsx                 # Overview placeholder
│   ├── live/page.tsx            # Live monitor placeholder
│   ├── devices/page.tsx         # Devices placeholder
│   ├── alerts/page.tsx          # Alerts placeholder
│   ├── quality/page.tsx         # Quality placeholder
│   ├── analytics/page.tsx       # Analytics placeholder
│   ├── insights/page.tsx        # Insights placeholder
│   └── fields/[id]/page.tsx     # Field-detail placeholder
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
