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

## Vercel

Set the repository **Root Directory** to `web`. Preview deployments should use `DATA_MODE=mock`. Production can use mock mode for the project demo, or `api` mode only when FastAPI is available at a public HTTPS URL (for example through a Cloudflare Tunnel or hosted VM). `API_BASE_URL` and `API_KEY` remain server-only variables; do not prefix them with `NEXT_PUBLIC_`.

Build checks:

```sh
bun run lint
bun run typecheck
bun run test
bun run build
```
