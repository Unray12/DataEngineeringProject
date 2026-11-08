# Live monitor — M2, BR2 and BR3

## Behavior

`/live` uses shared read-only M2 hooks to render all fields, current values for
five metrics, active alerts, per-field coverage, and a selected field's five
24-hour charts. Select a farm/field or follow “View field charts”. Filters use
`farmId`/`fieldId` URL parameters. Devices links preserve this scope.

Charts show target bands when configured, shade explicit gaps, insert null
boundary points and never connect across gaps. Suspect/invalid measurements
are excluded from trusted values and listed with their quality in the table
alternative. No target is invented when a field has none configured.

Coverage counts occupied metric/time slots in the trailing 24-hour window,
deduplicates replays and divides by expected slots across all five metrics.
The expected interval is an explicit control (five minutes matches the mock
fixture). Configure it to the actual reporting schedule in API mode. Coverage
is unavailable if any metric request fails; null samples and declared gaps do
not count as received. Invalid non-null samples still count as received, even
though they are excluded from the trusted chart.

All live requests poll every 30 seconds, stop interval polling when hidden and
refresh on focus. Freshness advances with the clock, including after failed
requests. Dates use `NEXT_PUBLIC_TIMEZONE`. Loading, empty, retry and cached
failure states are explicit.

## Endpoints and source

Browser: `/api/farms`, `/api/farms/{id}/fields`, `/api/fields/{id}/latest`,
`/api/fields/{id}/series?hours=24&metric=…`, `/api/alerts`.
Only the server adapter in `lib/api` calls FastAPI; live responses require the
Cassandra source. Credentials never enter browser hooks.

The adapter accepts canonical envelopes and validates supported snake-case
payloads. It cannot invent target state, quality or gap metadata. The current
FastAPI omits some required fields, so these reads fail explicitly until its
owners supply the frozen contract. Conforming stubs exercise API mode without
changing FastAPI, database schemas, streaming jobs or batch jobs.

## Foundation and ownership

Shared hooks and the provider are exported from `lib/api/hooks.ts` and
`lib/api/provider.tsx`. `useActiveAlerts` uses the `alerts/list` invalidation
prefix already used by M3. Acknowledge remains active; resolved is excluded.
The page itself is the `useFarms()` mock example.

M4's root layout/shared chart/scope components have not landed. As Part D
permits, UI and URL-scope fallbacks live inside M2's feature folder (tracked in
[issue #10](https://github.com/Unray12/DataEngineeringProject/issues/10)).
`DataProvider` reuses an existing provider when M4 mounts it in the root.
The prepared root integration is `import { DataProvider } from
"@/lib/api/provider"` and wrap the layout's children in `<DataProvider>`.
M4 should also replace the temporary shell and adopt URL scope across its
navigation. No M3/M4-owned component files are edited here.

## Demo and verification

- BR2: `/live?fieldId=field-n01` — five values and charts; expand each table.
- BR3: `/live?fieldId=field-h01` — shaded soil gaps, coverage below 100%,
  suspect temperature excluded, and matching outage alert.
- Follow View devices — field scope is preserved; inspect the offline sensor.
- Hide/show the page — polling pauses/resumes; after 90 seconds stale warnings
  appear. Mock latest readings deliberately start two minutes old.

Run `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`.
Tests cover fixture schemas, outage coverage, replay/out-of-order samples,
null boundaries, excluded quality, routing validation and adapter errors.
Human teammate review, remote CI and Vercel Preview are separate delivery gates.
