-- Cassandra schema for the serving layer (near real-time path, BR1/BR2/BR3/BR8).
--
-- Design rule (AGENTS.md): query-first. One table per API query, with the
-- partition key chosen for that query, never a generic "one big table".
--
-- Tables (names match REQUIREMENTS.md section 5):
--   latest_by_field        GET /fields/{id}/latest        BR2 current conditions
--   readings_by_field_24h  GET /fields/{id}/series        BR2 last-24-hours series (TTL)
--   device_status          GET /devices/{id}/status       BR3/BR8 device health and gaps
--   alerts_by_field        GET /fields/{id}/alerts        BR8 alert history for one field
--   alerts_by_status       GET /alerts?status=open        BR8 active-alert list
--   alert_by_id            PATCH /alerts/{id}             BR8 acknowledge / resolve
--   alert_state_by_field   internal (streaming)           BR8 debounce, cooldown, lifecycle
--
-- Every readings table carries the lineage columns required by FR4.4
-- (source offsets, ingested_at, batch_id, quality_flag) so any figure on a
-- dashboard can be traced back to the batch that produced it.
--
-- Keyspace replication: 1 is correct for the single-node Compose cluster.
-- On a real cluster change this to 3 (NetworkTopologyStrategy).

CREATE KEYSPACE IF NOT EXISTS agri
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}
AND durable_writes = true;

USE agri;

-- ---------------------------------------------------------------------------
-- BR2 / FR2.2: latest reading per metric per field.
--
-- Query: "current value of every metric of one field". Partition key =
-- field_id keeps a whole field on one replica; clustering by metric means one
-- partition scan returns the complete current-state row of the field, which is
-- what the near real-time dashboard renders.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS latest_by_field (
    field_id      text,
    metric        text,
    farm_id       text,
    device_id     text,
    value         double,
    unit          text,
    measured_at   timestamp,   -- when the reading was taken (device clock, UTC)
    ingested_at   timestamp,   -- when Kafka accepted the event (FR4.4)
    quality_flag  text,        -- ok | implausible_jump (FR4.6: visibly flag)
    batch_id      bigint,      -- Spark micro-batch that wrote the row (FR4.4)
    source_topic  text,
    source_partition int,
    source_offset bigint,
    updated_at    timestamp,
    PRIMARY KEY ((field_id), metric)
) WITH default_time_to_live = 604800;  -- 7 days; overwritten by newer readings

-- ---------------------------------------------------------------------------
-- BR2 / FR2.3: last-24-hours series for one field and metric.
--
-- Query: "all readings of (field, metric) in the last N hours, oldest first".
-- The hourly bucket bounds the partition (24-48 rows per bucket) so the table
-- grows wide in time but never in partition size. TTL keeps only the window
-- the dashboard needs (AGENTS.md: readings TTL 24-48 h).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS readings_by_field_24h (
    field_id      text,
    metric        text,
    bucket        bigint,      -- floor(unix epoch of measured_at / 3600): hourly bucket
    measured_at   timestamp,
    device_id     text,
    value         double,
    unit          text,
    ingested_at   timestamp,
    quality_flag  text,
    batch_id      bigint,
    PRIMARY KEY ((field_id, metric), bucket, measured_at)
) WITH CLUSTERING ORDER BY (bucket ASC, measured_at ASC)
  AND default_time_to_live = 172800;  -- 48 h, per AGENTS.md

-- ---------------------------------------------------------------------------
-- BR3 / FR8.2: device health.
--
-- Query: "status of one device". Partition key = device_id; a point lookup
-- returns last-seen time, battery, signal and the most recent gap, which is
-- what /devices/{id}/status and the outage detector consume.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_status (
    device_id            text,
    field_id             text,
    farm_id              text,
    status               text,      -- online | offline
    last_seen            timestamp, -- max(measured_at) of accepted readings
    reporting_interval_s double,
    battery_pct          double,
    signal_quality       double,
    low_battery          boolean,
    poor_signal          boolean,
    gap_start            timestamp, -- open gap (null when no gap is in progress)
    gap_end              timestamp, -- set when the device came back
    last_batch_id        bigint,
    updated_at           timestamp,
    PRIMARY KEY ((device_id))
);

-- ---------------------------------------------------------------------------
-- BR8 / FR8.3, FR8.4: alert history of one field, and the active-alert list.
--
-- alerts_by_field: "history of one field, newest first" (dashboard drill-down,
-- alert analysis through gold tables later). alerts_by_status: "all alerts in
-- a given state, newest first" (the dashboard's active-alert panel); the
-- streaming job inserts on open and both the job and the API move rows between
-- status partitions on resolve (Cassandra cannot update a clustering column).
-- alert_by_id: the lookup table behind PATCH /alerts/{id} (BR8 acceptance
-- criterion: acknowledge and resolve through the API).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts_by_field (
    field_id      text,
    created_at    timestamp,
    alert_id      uuid,
    status        text,       -- open | acknowledged | resolved
    condition_code text,      -- low_soil_moisture | frost_risk | heat_stress | device_offline:<id> | ...
    alert_type    text,       -- human-readable type, e.g. "low soil moisture"
    severity      text,       -- info | warning | critical
    message       text,
    crop_code     text,
    device_id     text,
    metric        text,
    observed_value double,
    threshold_value double,
    batch_id      bigint,
    acknowledged_at  timestamp,
    acknowledged_by  text,
    resolved_at      timestamp,
    resolved_by      text,
    resolution       text,    -- condition_cleared | manual
    note             text,
    PRIMARY KEY ((field_id), created_at, alert_id)
) WITH CLUSTERING ORDER BY (created_at DESC, alert_id ASC)
  AND default_time_to_live = 7776000;  -- 90 days of history

CREATE TABLE IF NOT EXISTS alerts_by_status (
    status        text,
    created_at    timestamp,
    alert_id      uuid,
    field_id      text,
    condition_code text,
    alert_type    text,
    severity      text,
    message       text,
    crop_code     text,
    device_id     text,
    metric        text,
    observed_value double,
    threshold_value double,
    batch_id      bigint,
    PRIMARY KEY ((status), created_at, alert_id)
) WITH CLUSTERING ORDER BY (created_at DESC, alert_id ASC)
  AND default_time_to_live = 7776000;

CREATE TABLE IF NOT EXISTS alert_by_id (
    alert_id      uuid,
    field_id      text,
    condition_code text,
    created_at    timestamp,
    status        text,
    severity      text,
    message       text,
    updated_at    timestamp,
    PRIMARY KEY ((alert_id))
) WITH default_time_to_live = 7776000;

-- ---------------------------------------------------------------------------
-- BR8 / FR8.5: alert lifecycle state used by the streaming job.
--
-- One row per (field, condition) holds the debounce counter, the last
-- emission time (cooldown guard, together with alert_guard semantics) and the
-- currently open alert, so the micro-batch can implement "condition persisted
-- for N batches" and "one alert per condition per cooldown window" without a
-- stateful Spark operator and without scanning alerts_by_field.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_state_by_field (
    field_id        text,
    condition_code  text,
    debounce_count  int,
    last_emitted_at timestamp,
    open_alert_id   uuid,
    open_created_at timestamp,
    open_status     text,       -- open | acknowledged (resolved alerts are cleared)
    last_observed_value double,
    threshold_value double,
    device_id       text,
    last_batch_id   bigint,
    updated_at      timestamp,
    PRIMARY KEY ((field_id), condition_code)
);
