# Devices — M2, BR3

## Features and endpoints

`/devices` provides reported status, last seen/observation age, battery, signal
and 24-hour gap count; farm/field/status filters, sorting, URL farm/field scope,
and a keyboard-accessible detail drawer. The drawer includes gap start/end
history and recent readings via the additive continuity proposal in WEBAPP A5.
Dates use `NEXT_PUBLIC_TIMEZONE`. Polling is every 30 seconds while visible,
with focus refresh. Stale observations over 90 seconds warn even after request
failures. Loading, empty, retry and cached failure states are explicit.

Browser routes: `/api/farms`, `/api/farms/{id}/fields`, `/api/devices`,
`/api/devices/{id}/status`, `/api/devices/{id}/continuity`.
Shared hooks/provider are exported from M2's `lib/api`. The page uses a local
provider fallback pending M4's root integration, tracked in issue #10.

## Mock fixtures

M3's shared dataset is unchanged. Summary statuses/counts come from that data.
Normalized mock signal values (0–1) are labelled percent quality; actual
negative RSSI is labelled dBm. No signal-quality-to-RSSI conversion occurs.

The new feature-local `mock-continuity.ts` is a separate synthetic device demo:
seed derived from the device id, five-minute schedule, two metrics, up to 40
recent samples from the last 24 hours. Historical five-minute gap intervals
are spaced deterministically before the last observation, plus an ongoing gap
after the last-seen timestamp plus one interval for silent sensors. The history
count matches M3's summary (14 for the offline sensor, 3 for the stale sensor).
Samples inside gaps are omitted. These histories are labelled synthetic; they
are separate from the field-level series and are never substituted in API mode.

## API integration and limits

The existing DeviceStatus contract is unchanged. Existing FastAPI lacks actual
RSSI and reliable counts; incompatible status responses produce 502 rather
than fabricated values. It also lacks continuity: 404/405/501 from that endpoint
returns explicit `availability: unavailable`; service outages remain errors.
Conforming contract stubs can demonstrate API mode. Production compatibility
still needs the service owners. No database/table/schema changes are included.

The additive continuity schema, local fixture and WEBAPP proposal are prepared
for team review; owner notification/approval remains required before merge.
M4-owned layout/navigation/scope integration is pending. The temporary shell
is reused unchanged; its inherited static health label is not service evidence.

## Demo and verification

BR3: `/devices?farmId=farm-highland&fieldId=field-h01`, select offline status,
open its drawer, inspect closed/ongoing gaps and recent device samples.
Follow View live field conditions to retain URL scope.

Unit tests cover status envelopes, no invented fallback, dates/timezone,
90-second freshness, deterministic device histories, unavailable endpoints and
wrong-device protection. Run Bun lint/typecheck/test/build from `web`.
Human teammate review, CI and Vercel Preview remain delivery gates.
