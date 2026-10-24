# REQUIREMENTS.md — Agricultural Monitoring Data Platform

Domain: **Agriculture** (multi-farm field and sensor monitoring)

The course asks for at least **2 × n** business requirements, where n is the number of group members. This file defines **8** (n = 4). Each business requirement is broken down into functional requirements (FR) and acceptance criteria (AC) that the data engineering solution must satisfy.

## 1. Scope and user groups

| Code | User group | Needs |
|---|---|---|
| U1 | Farm managers | Consolidated view, trends and field comparisons to guide irrigation and resource decisions |
| U2 | Farm operators | Prompt alerts on abnormal conditions and device outages, with a way to record their response |
| U3 | Analysts | Historical data, seasonal comparisons and evaluation of management practices |
| U4 | Data team (internal) | Trustworthy, traceable and continuous data |

## 2. Solution overview

```
IoT Gateways / Sensors (LoRaWAN)
        │ push / API
        ▼
   Apache Kafka  ── durable ingestion buffer
        │
        ▼
Spark Structured Streaming  ── micro-batch, 30 s trigger
        ├── 2a fast write ──► Apache Cassandra ──► Near real-time dashboard (last 24 h)
        └── 2b raw stream ──► HDFS + Iceberg (bronze)
                                   │ medallion ETL (dbt on Spark)
                                   ▼
                          Gold Iceberg tables ──► Trino ──► Intraday / daily dashboard
```

A FastAPI service is the single access layer between the web app and the two serving paths (Cassandra and Trino).

**Two dashboard types**

| | Near real-time | Intraday / daily |
|---|---|---|
| Path | FastAPI → Cassandra | FastAPI → Trino → gold Iceberg |
| Window | Last 24 hours | Hours to full history |
| Freshness | Seconds to about a minute | Per gold refresh (hourly or daily) |
| Content | Current conditions, active alerts, device status | Trends, comparisons, seasonal analysis, summaries |

## 3. Business requirements

### BR1 — Centralize agricultural monitoring
**Description:** Provide a consolidated view of farms, fields, and monitoring devices so farm managers can oversee agricultural conditions consistently across multiple locations.

**Rationale:** Data from many farms and devices arrives in different shapes. A common model and a single serving layer replace per-site tools.

| ID | Functional requirement |
|---|---|
| FR1.1 | Maintain reference data for farms, fields and devices (including device-to-field mapping and location). |
| FR1.2 | Every measurement is stored with `farm_id`, `field_id` and `device_id` resolved from the reference data. |
| FR1.3 | The API exposes a farm → field → device hierarchy with each entity's current status. |
| FR1.4 | The near real-time dashboard shows all farms in one view, filterable by farm and field. |

**Acceptance criteria**
- A new farm, field or device added to the reference data appears in the dashboard without code changes.
- Measurements from an unknown device are quarantined and reported, not silently dropped or mis-assigned.

### BR2 — Improve awareness of field conditions
**Description:** Provide timely information about environmental and field conditions to reduce reliance on manual measurements and help farm operators recognize changes that may affect crops.

**Rationale:** The streaming path turns raw sensor readings into current-state views within about a minute.

| ID | Functional requirement |
|---|---|
| FR2.1 | Ingest soil moisture, soil temperature, air temperature, air humidity and rainfall readings through Kafka. |
| FR2.2 | Spark micro-batch (30 s trigger) writes latest readings and short rolling aggregates to Cassandra. |
| FR2.3 | The API returns the latest value per metric per field and a last-24-hours series. |
| FR2.4 | The near real-time dashboard shows current value, recent trend and the time of last update. |

**Acceptance criteria**
- Under normal load, a reading appears in the API within a target of 90 seconds after reaching Kafka (30 s trigger plus processing).
- Each dashboard panel shows a "data as of" timestamp.

### BR3 — Maintain monitoring continuity
**Description:** Minimize gaps in agricultural monitoring and preserve collected information despite temporary device, connectivity, or service interruptions, supporting continued operations and subsequent analysis.

**Rationale:** Kafka decouples devices from processing, and checkpointing plus idempotent writes allow recovery without loss or duplication.

| ID | Functional requirement |
|---|---|
| FR3.1 | Kafka retains events long enough (configurable, default 7 days) to replay after a processing outage. |
| FR3.2 | Spark streaming jobs use durable checkpoints and resume from the last committed offsets after restart. |
| FR3.3 | Writes to Cassandra and Iceberg are idempotent, so replays do not create duplicates. |
| FR3.4 | Late and out-of-order readings are accepted within a configured watermark. Older data is still stored in bronze and picked up by the next batch run. |
| FR3.5 | Gaps in each device's data are detected and recorded as explicit gap records, not hidden. |

**Acceptance criteria**
- Stopping the Spark streaming job for several minutes and restarting it results in no missing and no duplicated readings downstream.
- Replaying a Kafka range yields identical Cassandra and Iceberg content.
- A simulated device outage produces a gap record with start and end times.

### BR4 — Establish trustworthy agricultural data
**Description:** Ensure stakeholders have consistent, reliable, and traceable agricultural information, reducing the risk of decisions based on invalid, duplicated, or misleading measurements.

**Rationale:** Validation, de-duplication and lineage metadata at the point of ingestion keep bad data out of dashboards and make results auditable.

| ID | Functional requirement |
|---|---|
| FR4.1 | Enforce an explicit schema on every event. Reject malformed events to a quarantine table instead of failing the job. |
| FR4.2 | Validate ranges per metric (for example humidity 0–100 %, plausible temperature limits), and flag implausible jumps. |
| FR4.3 | De-duplicate on `(device_id, metric, measured_at)`. |
| FR4.4 | Keep lineage metadata on every record: source topic/partition/offset, `ingested_at`, `batch_id`, and the quality flag. |
| FR4.5 | Publish a daily data-quality summary (counts of valid, duplicate, out-of-range and quarantined records per device), built as a dbt model. |
| FR4.7 | Silver and gold dbt models carry tests (not null, unique key, accepted ranges), and a failing test blocks the affected gold refresh. |
| FR4.6 | Dashboards must exclude or visibly flag invalid data. |

**Acceptance criteria**
- Faults injected by the simulator (duplicates, spikes, malformed payloads, unknown devices) are all detected and counted in the quality summary.
- Any figure on a dashboard can be traced back to its source offsets and batch.

### BR5 — Support data-driven farm management
**Description:** Enable farm managers to use agricultural measurements and trends to guide irrigation, resource allocation, and field-management decisions, helping reduce waste and maintain suitable growing conditions.

**Rationale:** Gold aggregates turn raw measurements into indicators managers can act on.

| ID | Functional requirement |
|---|---|
| FR5.1 | Gold tables provide hourly and daily aggregates per field and metric (min, max, average, count, time outside the target range). |
| FR5.2 | Target ranges per crop and growth stage are configurable reference data. |
| FR5.3 | Gold indicators include time-in-range per field and a simple irrigation indicator (for example hours below the soil-moisture target). |
| FR5.4 | The intraday dashboard compares fields side by side on these indicators. |

**Acceptance criteria**
- Gold aggregates reconcile with the silver/bronze data for sampled fields and periods.
- Changing a target range updates the indicators on the next gold refresh.

### BR6 — Enable historical evaluation and planning
**Description:** Preserve historical agricultural information so stakeholders can compare conditions across periods, identify seasonal patterns, evaluate management practices, and plan future farming activities.

**Rationale:** Iceberg on HDFS keeps a full, queryable history with schema evolution and time travel.

| ID | Functional requirement |
|---|---|
| FR6.1 | Bronze retains all raw data, and gold retains aggregates for the full project history. |
| FR6.2 | Gold tables are partitioned by date (and by farm where it helps) for efficient range queries. |
| FR6.3 | The dashboard supports period-over-period comparisons (day vs day, week vs week, season vs season) and per-field history. |
| FR6.4 | Iceberg time travel is available to reproduce past reports. |
| FR6.5 | Small files from streaming writes are compacted on a schedule. |

**Acceptance criteria**
- A query over several months for one field returns within an agreed interactive time on the demo data volume.
- A report can be reproduced against an earlier Iceberg snapshot with identical results.

### BR7 — Make agricultural insights accessible
**Description:** Provide farm managers and analysts with understandable summaries, trends, and field comparisons, reducing the effort required to consolidate and interpret monitoring data manually.

**Rationale:** A thin API and web app expose ready-made summaries, so users never touch Kafka, Spark or SQL.

| ID | Functional requirement |
|---|---|
| FR7.1 | FastAPI is the only access layer for the web app (no direct database or storage access from the frontend). |
| FR7.2 | Provide endpoints for summaries (per farm or field), trends and field comparisons, from both Cassandra and Trino. |
| FR7.3 | The web app offers the near real-time dashboard and the intraday/daily dashboard with consistent filters. |
| FR7.4 | Responses from Trino are cached briefly in the API, and results are paginated. |
| FR7.5 | Charts are understandable without technical knowledge: plain labels, units, time ranges, and data-freshness indicators. |

**Acceptance criteria**
- A manager can reach the summary for any field in at most a few clicks.
- Analytical charts load within an agreed time on the demo data volume.

### BR8 — Support early response to agricultural risks
**Description:** Enable farm operators to identify abnormal field conditions and monitoring-device outages promptly, track their response, and address issues before they escalate into avoidable crop damage or operational disruption.

**Rationale:** Streaming rules run on every micro-batch, and an alert lifecycle in Cassandra lets operators record what was done.

| ID | Functional requirement |
|---|---|
| FR8.1 | Detect threshold breaches per metric and crop (for example low soil moisture, extreme temperature, abnormal humidity) and abnormal rate of change. |
| FR8.2 | Detect device outages when no data arrives for a configurable multiple of the device's reporting interval. Also flag low battery and poor signal quality. |
| FR8.3 | Alerts are stored with type, severity, field, device, start time and status. |
| FR8.4 | Alert lifecycle: **open → acknowledged → resolved**, with who, when and an optional note. Outage alerts close automatically when data resumes. |
| FR8.5 | Avoid alert floods: debounce (condition must persist for N micro-batches) and cooldown per alert type. |
| FR8.6 | The near real-time dashboard lists active alerts. Alert history is available for analysis through gold tables. |

**Acceptance criteria**
- Simulated threshold breaches and device outages create exactly one alert each, within one or two trigger intervals plus the debounce.
- An operator can acknowledge and resolve an alert through the API, and the history is preserved.

## 4. Traceability

| Requirement | Kafka | Spark streaming | Cassandra | Iceberg (bronze/gold) | dbt batch | Trino | FastAPI / web |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| BR1 Centralize monitoring | ✔ | ✔ | ✔ | ✔ | | ✔ | ✔ |
| BR2 Field-condition awareness | ✔ | ✔ | ✔ | | | | ✔ |
| BR3 Monitoring continuity | ✔ | ✔ | ✔ | ✔ | ✔ | | |
| BR4 Trustworthy data | | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| BR5 Data-driven management | | | | ✔ | ✔ | ✔ | ✔ |
| BR6 Historical evaluation | | | | ✔ | ✔ | ✔ | ✔ |
| BR7 Accessible insights | | | ✔ | ✔ | | ✔ | ✔ |
| BR8 Early response to risks | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

## 5. Data model (summary)

- **Reference:** `farms`, `fields`, `devices`, `crop_targets` (target ranges)
- **Measurements:** `device_id`, `field_id`, `metric`, `value`, `unit`, `measured_at`, `received_at`, quality flag, lineage columns
- **Device health:** battery, signal quality, last-seen, gap records
- **Alerts:** `alert_id`, type, severity, field/device, status, timestamps, responder, note
- **Quality:** quarantine table and daily quality summary

Cassandra tables are query-first (for example `latest_by_field`, `readings_by_field_24h` with TTL, `alerts_by_field`, `device_status`). Iceberg schemas: `bronze`, `silver` (cleaned and de-duplicated), `gold`.

## 6. Non-functional requirements

| Area | Target (adjustable after benchmarking) |
|---|---|
| Near real-time freshness | Reading visible in the API within 90 s of reaching Kafka |
| Cassandra read latency | Point lookups within tens of milliseconds on demo data |
| Gold refresh | Hourly for intraday, daily for daily summaries |
| Durability | No data loss on restart of any single service |
| Idempotency | Replays and re-runs create no duplicates |
| Deployment | Everything runs with Docker Compose profiles |
| Developer workflow | Python environments locked with `uv`, routine tasks run as `just` recipes, batch transformations are dbt models with tests |
| Security | No credentials in the repo, configuration through environment variables |

## 7. Evaluation and benchmarking (course requirement)

Each requirement's rationale should be backed by measurements:

1. **Micro-batch trigger interval** (10 s / 30 s / 60 s): alert latency, throughput, CPU and memory use (BR2, BR8).
2. **Cassandra vs Trino-on-Iceberg** for the same dashboard query: latency and concurrency (BR2, BR7).
3. **Iceberg vs plain Hive/Parquet:** query time, small files, schema evolution, time travel (BR6).
4. **Effect of compaction** on Trino query time after many streaming commits (BR6).
5. **Recovery test:** restart, replay and duplicate checks (BR3, BR4).

## 8. Out of scope

- Airflow or other external orchestrators (batch runs are `just` recipes triggered by a lightweight scheduler).
- Prometheus and Grafana (health is shown through logs and the data-quality and device-status tables).
- Flink and other streaming engines (Spark micro-batch only).
- Real device firmware or LoRaWAN network server (sensors are simulated).
