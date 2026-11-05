# Alerts

- Owner: M3
- Requirements: BR8
- Pages: `/alerts`
- Endpoints: FastAPI alert list and acknowledge/resolve transition contracts

Previous implementation (for reference only): git tag archive/webapp-v1, path `web/src/components/dashboard.tsx`

## What it does

- Filters by status, severity, type, farm and field, with newest/oldest/severity sorting.
- Detail drawer with the trigger (observed vs threshold), field/device context and a
  status timeline.
- Acknowledge and resolve actions with an optional note (max 500 characters). The
  responder name is read from the `agrimonitor.responder` localStorage key; if it is
  missing the action dialog asks for it.
- Optimistic updates with rollback on error. After a change every `["alerts"]` query
  is invalidated, so any other alert surface sees the same state.
- Mock mode keeps the lifecycle in a `globalThis` in-memory store, because Next.js
  bundles route handlers separately.

## Endpoints

| Endpoint | Source | Notes |
|---|---|---|
| `GET /api/alerts?status=&severity=&type=&fieldId=&farmId=` | Cassandra | Zod-validated query, `no-store` |
| `GET /api/alerts/reference` | Cassandra | Farms, fields and devices for the filters and drawer; cached 5 min |
| `PATCH /api/alerts/{id}` body `{ action, by, note? }` | Cassandra | 400 invalid body, 404 unknown alert, 409 invalid transition |

The browser never calls FastAPI. In `DATA_MODE=api` the adapter maps camelCase to
the FastAPI `{ actor, note }` body and post-filters severity/type/farm because the
current FastAPI list endpoint only filters by status.

## State machine

`state.ts` mirrors `ALLOWED_TRANSITIONS` in `src/streaming/alerts.py`:

| Current | acknowledge | resolve |
|---|---|---|
| `open` | → `acknowledged` | → `resolved` |
| `acknowledged` | rejected (409) | → `resolved` |
| `resolved` | rejected (409) | rejected (409) |

`canAct()` drives which buttons are rendered, so the UI cannot construct an invalid
transition. The route handler validates it again (defence in depth).

## Data gaps in API mode

The current FastAPI list response may omit lifecycle timestamps. `timeline.ts` keeps
the event but renders `chưa có dữ liệu` for a missing time. Severity and type
filters work in the adapter even though FastAPI does not accept them directly.

## Safety and accessibility

- Notes are rendered as React text nodes, never with `dangerouslySetInnerHTML`.
  `web/tests/alert-note.test.tsx` covers a `<img onerror>` payload.
- Status is always shown as text as well as colour.
- The table, drawer, dialog, filters and timeline are keyboard reachable; Escape
  closes the drawer or dialog.

## Tests

```sh
cd web
bun run test -- tests/alerts-state.test.ts tests/alerts-timeline.test.ts tests/alerts-route.test.ts
```

(or `npm run test -- ...` when Bun is unavailable).
