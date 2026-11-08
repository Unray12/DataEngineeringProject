# Web App Build Prompt — split into 4 work packages

This file is a prompt kit for a team of **4 members** (M1–M4). Each member gives their coding agent (or follows themselves):

1. **Part A** (shared context, identical for everyone)
2. **Part B** (their own Phase 0 foundation task)
3. **Part C** (their own Phase 1 work package)

Part D has the team rules and Part E the integration checklist.

**Work plan**

| Phase | What | Who |
|---|---|---|
| Phase 0 (about 1 day) | Foundation, 4 equal pieces | M1 scaffold, M2 contract and data layer, M3 mock data, M4 app shell and shared UI |
| Phase 1 (parallel) | Feature work, 2 business requirements each | M1: BR1 + BR7, M2: BR2 + BR3, M3: BR4 + BR8, M4: BR5 + BR6 |
| Phase 2 | Integration, polish, deploy | Everyone (Part E) |

| Member | Business requirements | Pages / features owned |
|---|---|---|
| M1 | BR1 Centralize monitoring, BR7 Accessible insights | `/` Overview, `/fields/[id]`, `/insights` (summaries, field comparison) |
| M2 | BR2 Field-condition awareness, BR3 Monitoring continuity | `/live` near real-time dashboard, `/devices`, coverage indicators |
| M3 | BR4 Trustworthy data, BR8 Early response to risks | `/alerts` (lifecycle, response tracking), `/quality` (quality and lineage) |
| M4 | BR5 Data-driven management, BR6 Historical evaluation | `/analytics` (indicators, history, period-over-period, seasonal) |

---

# PART A — Shared context (everyone reads this)

## A1. Role and way of working

You are a senior full-stack engineer on a 4-person team. Post a short plan first, then implement. Touch **only the files your work package owns** (Part D). After each milestone run lint, typecheck, tests and build, and fix problems before moving on. At the end, report what you verified and what you could not verify.

## A2. Project context

This web app is the presentation layer of an agricultural monitoring data platform (data engineering course project, domain: agriculture).

```
LoRaWAN sensors → Kafka → Spark Structured Streaming (30 s micro-batch)
   ├─► Cassandra ─► FastAPI ─► Near real-time dashboard (last 24 h)
   └─► HDFS + Iceberg (bronze) → dbt on Spark → gold Iceberg → Trino ─► FastAPI ─► Intraday / daily dashboard
```

Users: farm managers, farm operators, analysts, data team. The 8 business requirements:

| ID | Requirement |
|---|---|
| BR1 | Centralize agricultural monitoring: one consolidated view of farms, fields and devices |
| BR2 | Improve awareness of field conditions: timely environmental information |
| BR3 | Maintain monitoring continuity: make gaps and outages visible, nothing silently hidden |
| BR4 | Establish trustworthy data: quality, traceability, no invalid or duplicated values presented as real |
| BR5 | Support data-driven farm management: indicators for irrigation and resource decisions |
| BR6 | Enable historical evaluation and planning: compare periods, seasonal patterns |
| BR7 | Make insights accessible: understandable summaries, trends, field comparisons |
| BR8 | Support early response to risks: abnormal conditions, device outages, response tracking |

## A3. Stack (fixed)

- **Next.js** (latest stable, App Router), **TypeScript** `strict: true`
- **Bun** for package management and scripts (`bun install`, `bun run dev|build|lint|typecheck|test`). Commit `bun.lock`, set `packageManager`. No Bun-specific runtime APIs in app code (Vercel runs route handlers on Node.js).
- **Tailwind CSS** + **shadcn/ui**, **Recharts** (only chart library), **TanStack Query**, **Zod**, **date-fns** + **date-fns-tz**
- **Vitest** for unit tests, optional **Playwright** smoke test
- ESLint + Prettier. No other major dependencies without justification.

## A4. Architecture rules

1. The browser never calls FastAPI directly. **Next.js Route Handlers** (`src/app/api/*`) act as a thin backend-for-frontend: call FastAPI server-side, validate with Zod, return JSON.
2. The app never touches Kafka, HDFS, Cassandra or Trino. FastAPI is the only data access layer.
3. All FastAPI calls go through `src/lib/api/` (the adapter). If the real API differs from the contract, only the adapter changes.
4. **Never mix sources inside one chart.** Near real-time views use only Cassandra-backed endpoints, analytical views use only Trino-backed endpoints.
5. `DATA_MODE=mock` (default) uses deterministic generated data, so previews and demos work without the backend. `DATA_MODE=api` calls FastAPI at `API_BASE_URL`. Vercel cannot reach `localhost`, so api mode needs a public HTTPS FastAPI URL (for example a Cloudflare Tunnel or a VM).

| Env var | Purpose | Default |
|---|---|---|
| `DATA_MODE` | `mock` or `api` | `mock` |
| `API_BASE_URL` | FastAPI base URL (api mode) | none |
| `API_KEY` | Sent to FastAPI as a header, server-only | none |
| `APP_PASSWORD` | Optional shared password gate (middleware) | none |
| `NEXT_PUBLIC_APP_NAME` | Display name | `AgriMonitor` |
| `NEXT_PUBLIC_TIMEZONE` | Display timezone | `Asia/Ho_Chi_Minh` |

All env vars are validated with Zod at startup. Provide `.env.example`. Never commit secrets.

## A5. API contract (frozen after Phase 0)

Every response uses an envelope:

```ts
type Envelope<T> = { data: T; meta: { asOf: string; source: "cassandra" | "trino" } };
```

| Endpoint | Source | Used by |
|---|---|---|
| `GET /farms`, `GET /farms/{id}/fields` | Cassandra | shared hooks |
| `GET /devices`, `GET /devices/{id}/status` | Cassandra | M2 (shared read-only hook for others) |
| `GET /fields/{id}/latest`, `GET /fields/{id}/series?hours=24&metric=` | Cassandra | M2 |
| `GET /alerts?status=&severity=&fieldId=`, `PATCH /alerts/{id}` | Cassandra | M3 (read-only hook for others) |
| `GET /summary?from=&to=`, `GET /compare?fieldIds=&metric=&from=&to=` | Trino | M1 |
| `GET /quality/summary?from=&to=`, `GET /quality/devices` | Trino | M3 |
| `GET /fields/{id}/indicators?from=&to=&granularity=`, `GET /fields/{id}/history?from=&to=&granularity=&metric=` | Trino | M4 |

`PATCH /alerts/{id}` body: `{ action: "acknowledge" | "resolve", by: string, note?: string }`.

Core types (Zod schemas, with inferred TypeScript types):

```ts
type Metric  = "soil_moisture" | "soil_temperature" | "air_temperature" | "air_humidity" | "rainfall";
type Quality = "valid" | "suspect" | "invalid";
type Health  = "ok" | "attention" | "critical";

type Farm  = { id: string; name: string; region: string; fieldCount: number; deviceCount: number; status: Health };
type Field = { id: string; farmId: string; name: string; crop: string; growthStage: string; areaHa: number; lat?: number; lng?: number;
               status: Health; targets: Partial<Record<Metric, { min: number; max: number }>> };

type Latest = { fieldId: string; metrics: { metric: Metric; value: number; unit: string; measuredAt: string; quality: Quality; state: "low" | "ok" | "high" }[] };
type Series = { fieldId: string; metric: Metric; unit: string; points: { t: string; value: number | null; quality: Quality }[]; gaps: { start: string; end: string }[] };

type DeviceStatus = { id: string; fieldId: string; status: "online" | "stale" | "offline"; lastSeen: string; batteryPct: number; rssi: number; gapCount24h: number };

type Alert = { id: string; type: "threshold" | "rate_of_change" | "device_outage" | "low_battery"; severity: "info" | "warning" | "critical";
               fieldId: string; deviceId?: string; metric?: Metric; status: "open" | "acknowledged" | "resolved"; message: string;
               openedAt: string; acknowledgedAt?: string; acknowledgedBy?: string; resolvedAt?: string; resolvedBy?: string; note?: string };

type IndicatorRow  = { bucket: string; metric: Metric; min: number; max: number; avg: number; count: number; timeInRangePct: number; hoursBelowTarget?: number };
type QualityDay    = { date: string; valid: number; duplicate: number; outOfRange: number; quarantined: number };
type DeviceQuality = { deviceId: string; counts: Omit<QualityDay, "date">; lineage: { batchId: string; topic: string; partition: number; offset: number; ingestedAt: string }[] };
```

Contract changes after Phase 0 need a PR that updates the Zod schema, the mock data and this file, with all members notified.

### M2 additive continuity proposal (BR3; pending team review)

The existing endpoints and `DeviceStatus` are unchanged. Proposed read-only
`GET /devices/{id}/continuity` (browser: `/api/devices/{id}/continuity`) uses a
Cassandra envelope and the following additional response. No database schema
changes are part of this proposal.

```ts
type DeviceContinuity =
  | { availability: "available"; deviceId: string;
      gaps: { start: string; end: string | null }[];
      readings: { deviceId: string; metric: Metric; measuredAt: string;
                  value: number | null; unit: string; quality: Quality }[] }
  | { availability: "unavailable"; deviceId: string; reason: string };
```

`end: null` means an ongoing gap. Every returned reading must belong to the
requested device. A service without this endpoint yields `unavailable`; network
and processing failures remain errors. M2's synthetic history fixture is local
to `features/devices/mock-continuity.ts`, documented in that feature's README;
M3's shared dataset is unchanged. Existing FastAPI has no such endpoint.
This proposal needs the owners' review and notification before merge; adding
this paragraph does not represent that approval.


## A6. Caching and refresh

| Data | Route handler | Client |
|---|---|---|
| Live (latest, series, devices, alerts) | `cache: "no-store"` | Poll every 30 s, pause when tab hidden, refetch on focus |
| Analytics and quality | `revalidate` 60–300 s | Refetch on filter change, no polling |
| Reference (farms, fields) | `revalidate` 300 s | Stale-while-revalidate |

FastAPI calls have a 10 s timeout and typed errors with friendly messages.

## A7. UX rules (all pages)

- Loading skeletons, empty states, error states with retry, on every data panel.
- Plain labels and units. No technical jargon in primary UI (Kafka, Cassandra and so on stay out of user-facing text, except lineage details on `/quality`).
- Every data panel shows **"Data as of …"** from `meta.asOf`. Live data older than 90 s shows a stale warning.
- **Gaps are shown as gaps**: break lines and shade the interval, never interpolate silently. `suspect` and `invalid` points are visibly marked or excluded.
- Responsive (phone to wide desktop), keyboard accessible, WCAG AA contrast, color-blind-safe palette, status never by color alone, charts have an `aria-label` and a table alternative for key charts.
- Timestamps are UTC ISO strings in transport and shown in `NEXT_PUBLIC_TIMEZONE`.

## A8. Security

- `API_KEY` and `API_BASE_URL` are server-only. No secret has a `NEXT_PUBLIC_` prefix.
- If `APP_PASSWORD` is set, middleware gates all pages and API routes.
- Validate all route-handler inputs (query params, `PATCH` bodies) with Zod. Treat alert `note` text as untrusted when rendering.
- Basic security headers in `next.config.ts`.

## A9. Repository layout (monorepo, app in `web/`)

Set Vercel's **Root Directory** to `web`. The layout is organized by feature (vertical slices) so members rarely touch the same files:

```
web/
├── package.json  bun.lock  tsconfig.json  next.config.ts  .env.example  README.md
├── src/
│   ├── app/                         # thin route files that import from features; app/api/<feature>/* route handlers
│   ├── features/
│   │   ├── overview/   (M1)         # components, hooks, api client, mock, tests
│   │   ├── field-detail/ (M1)
│   │   ├── insights/   (M1)
│   │   ├── live/       (M2)
│   │   ├── devices/    (M2)
│   │   ├── alerts/     (M3)
│   │   ├── quality/    (M3)
│   │   └── analytics/  (M4)
│   ├── components/ui/               # shadcn (M1 scaffold)
│   ├── components/shared/           # shared UI (M4)
│   ├── lib/api/                     # adapter, schemas, typed errors, shared read-only hooks (M2)
│   ├── lib/mock/base.ts             # seeded base dataset (M3)
│   ├── lib/env.ts  lib/format.ts    # env (M1), format helpers (M4)
│   └── types/
└── tests/
```

---

# PART B — Phase 0: Foundation (about 1 day, 4 equal tasks)

Order: **M1's scaffold PR merges first** (target: within 1–2 hours). M2 then publishes types/schemas early (target: within the first half day) because M3 and M4 depend on them. Everyone else branches from the scaffold and builds against the types as soon as they are available.

## B-M1 — Repo scaffold, CI and deploy setup
- Create `web/` with Next.js (App Router), TypeScript strict, Tailwind, shadcn/ui, ESLint, Prettier, Vitest, Bun (`bun.lock`, `packageManager`).
- `src/lib/env.ts` with Zod validation for all env vars in A4, plus `.env.example`.
- Create the empty feature folders from A9 (each with a short README stating its owner) and thin placeholder route pages: `/`, `/live`, `/devices`, `/alerts`, `/quality`, `/analytics`, `/insights`, `/fields/[id]`.
- Scripts: `lint`, `typecheck`, `test`, `build`, `dev`.
- GitHub Actions `.github/workflows/web-ci.yml` (on pull requests and pushes touching `web/**`): setup Bun, `bun install --frozen-lockfile`, lint, typecheck, test, build with `DATA_MODE=mock`.
- Security headers and optional `APP_PASSWORD` middleware.
- `web/README.md`: setup, mock vs api mode, and Vercel steps: import repo, Root Directory `web`, Next.js preset (Bun detected from `bun.lock`; if needed Install Command `bun install --frozen-lockfile`, Build Command `bun run build`), env vars (previews `DATA_MODE=mock`), `main` = Production, PRs = Preview, how to expose FastAPI over HTTPS for api mode.
- Deploy a first working placeholder to Vercel to prove the pipeline.

**Done when:** CI is green on `main`, a Vercel production and preview URL both work, and the other three members can clone and run `bun run dev`.

## B-M2 — Contract, adapter and shared data hooks
- Implement all Zod schemas and inferred types from A5 in `src/types` and `src/lib/api/schemas.ts`, and publish them early.
- `src/lib/api/client.ts`: envelope handling, 10 s timeout, typed errors, server-side header injection (`API_KEY`), switch between mock and api by `DATA_MODE`.
- A small helper for route handlers: validate input, call adapter, apply cache policy from A6, return typed JSON or error.
- Shared **read-only** TanStack Query hooks used by everyone: `useFarms`, `useFields(farmId?)`, `useDevices(fieldId?)`, `useActiveAlerts(scope?)`. Wrap the TanStack provider in the app layout together with M4.
- Route handlers for farms, fields and devices (`/api/farms`, `/api/farms/[id]/fields`, `/api/devices`).
- Unit tests: schemas parse mock fixtures, client error mapping, timeout.

**Done when:** schemas and hooks are merged, and a one-page example shows `useFarms()` rendering from mock data.

## B-M3 — Seeded mock dataset
- `src/lib/mock/base.ts`: a deterministic, seeded generator (given a fixed seed, output is identical on every run) producing:
  - 3 farms, about 12 fields with different crops and target ranges, about 40 devices
  - readings every 5 minutes for the last 24 hours, about 90 days of hourly aggregates, daily and seasonal patterns plus noise
  - alerts in all lifecycle states
  - quality data (daily counts, per-device counts, lineage records)
- **Deliberate anomalies** (documented in a fixtures table in the README of `lib/mock`): a device outage with a gap, a stale device, a low-battery device, a soil-moisture threshold breach, a temperature spike flagged `suspect`, duplicates and quarantined counts, an outage alert that auto-resolves.
- Pure functions per resource (`getFarms`, `getLatest`, `getSeries`, `getIndicators`, …) returning contract types, so each feature's mock layer can use them.
- Unit tests that every generated payload satisfies the Zod schemas (from M2).

**Done when:** every endpoint in A5 can be served from the base dataset and the anomalies above are present and tested.

## B-M4 — App shell and shared UI
- Root layout: sidebar navigation (mobile: drawer or bottom bar), light and dark theme toggle, TanStack Query provider (with M2), page header component.
- **Global farm/field filter** stored in URL search params, with a `useScope()` hook used by all pages.
- Shared components in `src/components/shared/`: `StatusBadge` (icon and text, not color only), `FreshnessBadge` ("Data as of …", stale after 90 s), `MetricCard`, gap-aware `TimeSeriesChart` wrapper around Recharts (target band, gap shading, invalid-point marking, aria-label, table alternative), `DataPanel` (skeleton, empty, error with retry), `DateRangePicker`.
- `src/lib/format.ts`: units, number formatting, timezone-aware dates, and `describeChange(current, previous, metric)` that returns plain-language sentences such as "Soil moisture was 8% lower than last week".
- Colour-blind-safe chart palette and Tailwind theme tokens.
- Component tests for `TimeSeriesChart` gap handling and `FreshnessBadge`.

**Done when:** a demo page (or Storybook-style route `/dev/ui`) shows every shared component in loading, empty, error and populated states.

---

# PART C — Phase 1: Work packages (parallel)

Each package is a **vertical slice**: page(s) in `src/app/…` (thin), feature code in `src/features/<name>/`, route handlers in `src/app/api/<name>/`, any package-specific mock layer, and tests. Use the shared components and hooks from Phase 0. Don't edit another member's folders.

## C-M1 — BR1 Centralize monitoring + BR7 Accessible insights

**Owns:** `features/overview`, `features/field-detail`, `features/insights`, routes `/`, `/fields/[id]`, `/insights`, `app/api/summary`, `app/api/compare`.

**Features**
1. **Overview `/` (BR1)**
   - Summary cards: farms, fields, devices online/stale/offline, open alerts.
   - Farm → field list with status chips and a mini row of latest conditions, filterable through the global scope.
   - "What needs attention" panel: top open alerts (via `useActiveAlerts`) and offline devices (via `useDevices`), in plain language.
   - Stretch: small field map (MapLibre or Leaflet, dynamically imported).
2. **Field detail `/fields/[id]` (BR1)**: metadata (crop, growth stage, area, target ranges), device list, recent alerts, and deep links to `/live`, `/analytics` and `/insights` pre-filtered to the field.
3. **Insights `/insights` (BR7)**
   - Plain-language summaries ("what changed since yesterday", "fields needing attention this week") built by a pure, unit-tested module `features/insights/narrative.ts` using `describeChange`.
   - **Field comparison**: ranked table plus small-multiple charts for a chosen metric and date range, from `GET /compare`.
   - Summary cards from `GET /summary`. Data labelled with `asOf` and the note that this data is not live.
   - CSV export of the comparison table.

**Acceptance criteria**
- A new farm/field added to the mock data appears in the overview with no code change.
- The overview works for 3 farms and 12 fields without clutter on a phone-sized screen.
- Every summary sentence is generated from data and covered by unit tests, including edge cases (no data, zero change).
- Insights charts use Trino-backed endpoints only.

**Depends on:** `useFarms`, `useFields`, `useDevices`, `useActiveAlerts` (M2), shared UI (M4), mock base (M3).

## C-M2 — BR2 Field-condition awareness + BR3 Monitoring continuity

**Owns:** `features/live`, `features/devices`, routes `/live`, `/devices`, `app/api/live/*`, `app/api/fields/[id]/latest`, `app/api/fields/[id]/series`, `app/api/devices/[id]/status`.

**Features**
1. **Live dashboard `/live` (BR2)**
   - Field selector plus an all-fields overview grid.
   - Per metric (soil moisture, soil temperature, air temperature, air humidity, rainfall): current value and unit, state vs target (low / ok / high), 24-hour line chart with target band.
   - Polling every 30 s via TanStack Query, paused when the tab is hidden, refetch on focus.
   - Freshness badge on every panel, stale warning after 90 s.
   - Active alerts panel (read-only, via `useActiveAlerts`) linking to `/alerts`.
2. **Continuity (BR3)**
   - Gaps drawn as gaps with shaded intervals, based on `Series.gaps`. Never interpolate.
   - **Monitoring coverage indicator** per field: percentage of expected readings received in the last 24 h, computed by a pure unit-tested function.
   - `suspect` and `invalid` points marked or excluded, with a legend.
3. **Devices `/devices` (BR3)**
   - Table: status (online / stale / offline), last seen, battery, signal, gap count, filters and sorting.
   - Device detail drawer with gap history and recent readings.
   - Clear visual distinction between stale and offline, with the thresholds explained in a tooltip.

**Acceptance criteria**
- The mock outage appears as a visible gap and lowers the coverage indicator of the affected field.
- Stopping and restarting polling (hide/show tab) works and shows no duplicate requests.
- Stale data (> 90 s) shows the warning in a test using a mocked clock.
- `/live` uses only Cassandra-backed endpoints.

**Depends on:** schemas and hooks (M2's own Phase 0), shared chart and badges (M4), mock base (M3), `useActiveAlerts`.

## C-M3 — BR4 Trustworthy data + BR8 Early response to risks

**Owns:** `features/alerts`, `features/quality`, routes `/alerts`, `/quality`, `app/api/alerts/*`, `app/api/quality/*`.

**Features**
1. **Alerts `/alerts` (BR8)**
   - Table with filters (status, severity, type, farm/field) and sorting.
   - Detail drawer: trigger explanation, affected field/device, **timeline** of status changes.
   - **Acknowledge** and **Resolve** with an optional note. Responder name comes from a "your name" setting in `localStorage` (try/catch around access). Optimistic updates with rollback on error.
   - Alert state machine as a pure module `features/alerts/state.ts` (open → acknowledged → resolved, invalid transitions rejected, device-outage alerts auto-resolve when data resumes), with exhaustive unit tests.
   - Mock mode: in-memory alert state so the lifecycle works in demos.
   - Export mutation hooks and keep `useActiveAlerts` (from M2) in sync by invalidating its query key after changes.
2. **Data quality `/quality` (BR4)**
   - Daily stacked bar chart: valid, duplicate, out-of-range, quarantined.
   - Per-device quality table with drill-down to lineage (batch id, topic/partition/offset, ingested time).
   - Short plain-language explanations of each term (tooltip or help panel).
   - "Traceability" view: pick a displayed value and see where it came from, where the mock data supports it.

**Acceptance criteria**
- Acknowledging then resolving an alert updates the table, the drawer timeline and the active-alerts panels on other pages.
- Invalid state transitions are impossible from the UI and rejected by the route handler.
- Injected faults in the mock data (duplicates, quarantined records) appear in the quality charts and tables with counts that match the mock fixtures.
- Alert notes are rendered safely (no HTML injection).

**Depends on:** schemas (M2), mock base with alerts and quality seeds (M3's own Phase 0), shared UI (M4).

## C-M4 — BR5 Data-driven management + BR6 Historical evaluation

**Owns:** `features/analytics`, route `/analytics`, `app/api/analytics/*` (indicators, history).

**Features**
1. **Controls**: date range picker with presets (today, 7 days, 30 days, season), granularity (hourly, daily), metric and field selection, all in URL params so views are shareable.
2. **Management indicators (BR5)**
   - Trend charts per metric with min, max, average.
   - Time-in-range percentage per field and metric.
   - **Irrigation indicator**: hours below the soil-moisture target per field, with a plain-language recommendation line (for example "Field 3 spent 9 hours below target this week").
3. **Historical evaluation (BR6)**
   - Period-over-period comparison: day vs day, week vs week, season vs season, with deltas and a sentence from `describeChange`.
   - **Seasonal view**: weekly or monthly averages overlaid by season or year, to spot patterns and support planning.
   - Per-field history with long ranges (up to the full 90 days of mock data) that stay responsive (downsample or aggregate for display).
4. Notice "Data as of last refresh …, not live" using `meta.asOf`. CSV export of displayed tables. Route handlers use `revalidate` 60–300 s.

**Acceptance criteria**
- Period-over-period deltas and time-in-range are computed by pure, unit-tested functions, and match values calculated by hand from the mock fixtures.
- A 90-day, hourly-granularity view renders smoothly (no long main-thread blocking).
- Changing a field's target range in the mock data changes the indicators accordingly.
- `/analytics` uses only Trino-backed endpoints.

**Depends on:** schemas and adapter (M2), mock base with 90-day aggregates (M3), shared UI, `DateRangePicker` and `describeChange` (M4's own Phase 0).

---

# PART D — Team rules

**Branching and PRs**
- Branch names: `feat/<member>-<feature>` (for example `feat/m2-live-dashboard`). Small PRs, merged to `main` at least daily. Rebase on `main` before opening a PR.
- Each PR is reviewed by one other member. Commit messages mention the requirement (for example `feat(live): gap-aware 24h chart (BR2, BR3)`).
- CI must pass, and the Vercel Preview must load. Add a screenshot for UI changes.

**Ownership**
- Edit only the folders your package owns. Shared areas (`lib/api`, `lib/mock/base.ts`, `components/shared`, `lib/format.ts`, `lib/env.ts`) belong to their Phase 0 owner. Others propose changes with a small PR to the owner and don't edit them directly.
- Contract changes follow A5.
- If you need a shared component or data hook that doesn't exist, add an issue and meanwhile implement it locally inside your feature folder.

**Definition of done (per package)**
- Pages work in mock mode on mobile and desktop, with loading, empty and error states.
- Unit tests for pure logic, and `bun run lint`, `typecheck`, `test`, `build` pass.
- A short section in your feature folder's README: what it does, endpoints used, known limitations.
- Acceptance criteria in your package are all demonstrated.

---

# PART E — Phase 2: Integration checklist (everyone)

- [ ] Global farm/field scope works on every page, and links between pages keep the scope
- [ ] Active alerts agree across `/`, `/live` and `/alerts` after an acknowledge or resolve
- [ ] Every data panel shows "Data as of …", and live panels warn when stale
- [ ] The mock outage is visible as a gap on `/live`, as an offline device on `/devices`, as an alert on `/alerts`, and in the coverage and quality views
- [ ] Near real-time pages use only Cassandra-backed endpoints and analytical pages only Trino-backed endpoints
- [ ] Accessibility pass on every page: keyboard, contrast, chart labels and table alternatives
- [ ] `DATA_MODE=api` works against a real or stubbed FastAPI, with changes only in `src/lib/api/` if needed
- [ ] `bun run lint`, `typecheck`, `test`, `build` pass on `main`
- [ ] Vercel Production deploys from `main` with no code changes, and each PR gets a Preview
- [ ] The web README documents setup, mock vs api mode, Vercel steps and how to expose FastAPI over HTTPS
- [ ] Each business requirement BR1–BR8 has a demo path (page, action and expected result) listed in the web README for the final presentation

**Out of scope:** user accounts and OAuth (the optional password gate is enough), writes other than alert acknowledge/resolve, direct access to Kafka/HDFS/Cassandra/Trino/Spark, WebSockets (polling is enough), Prometheus and Grafana.