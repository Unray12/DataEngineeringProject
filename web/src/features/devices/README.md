# Devices — BR3 web scope

`/devices` displays device status, last observation, reporting interval when
available, farm/field/status filters, and the latest reported gap start/end.
It refreshes every 30 seconds and shares main's responsive application shell.

The server adapter sends only GET requests to the existing FastAPI endpoints:
`/devices`, `/farms`, `/farms/{id}/fields`, `/devices/{id}/status`.
Credentials remain server-side. Mock mode uses main's seeded dataset and is
labelled preview data; API failures never substitute mock values.

Missing reporting intervals and timestamps display Unavailable. The page does
not manufacture gap records or counts. The service exposes current device
state, not full gap history; this limitation is stated in the status panel.

This branch is web-only. Database definitions, Kafka/Spark jobs, dbt models,
Python dependencies, API handlers and infrastructure match origin/main. It
delivers the BR3 presentation layer and reuses main's BR4 Quality workspace;
it does not claim to implement or verify BR3/BR4 processing guarantees.

Checks: frontend typecheck, lint, tests and production build. Backend recovery
and batch checks are outside this branch; no database writes are needed.
