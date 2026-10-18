# AGENTS.md — Context for coding agents

Read this first, then `REQUIREMENTS.md`. This file records the project goal, the fixed design decisions and the working rules.

## Project goal

A course project: build a data engineering solution, proven successful in one application domain, here **agriculture**. The course focuses on data management and processing, with three parts: domain data, data engineering for the business requirements, and an application that delivers the results. We must define at least 2 × n business requirements (we have **8**), justify how data engineering supports each, and evaluate the chosen technologies, benchmarking alternatives where useful.

Business requirements (details and acceptance criteria in `REQUIREMENTS.md`):

BR1 centralize monitoring · BR2 field-condition awareness · BR3 monitoring continuity · BR4 trustworthy data · BR5 data-driven management · BR6 historical evaluation · BR7 accessible insights · BR8 early response to risks

## Architecture

```
LoRaWAN sensors/gateways ─push/API─► Kafka ─► Spark Structured Streaming (30 s micro-batch)
                                                  ├─► Cassandra ─► [FastAPI] ─► Near real-time dashboard (last 24 h)
                                                  └─► HDFS + Iceberg (bronze)
                                                          └─ dbt on Spark (medallion ETL) ─► Gold Iceberg ─► Trino ─► [FastAPI] ─► Intraday / daily dashboard
```

## Fixed decisions (do not change without asking)

| Concern | Choice |
|---|---|
| Hosting | Docker Compose with profiles |
| Ingestion | Lightweight ingest service (HTTP push) → Kafka (KRaft, no ZooKeeper) |
| Stream processing | **Spark Structured Streaming, micro-batch, 30 s `processingTime` trigger.** No Flink. |
| Batch processing | **dbt** (dbt-spark via Spark Thrift Server) builds bronze → silver → gold on Iceberg. Spark stays the execution engine. Use PySpark only for what dbt cannot do. |
| Lakehouse | Apache Iceberg on HDFS, schemas `bronze`, `silver`, `gold` |
| Catalog | Hive Metastore (Postgres-backed) |
| Operational serving store | **Apache Cassandra** (near real-time and alert state) |
| Analytical query engine | **Trino** over gold Iceberg tables |
| API | **FastAPI**, the only access layer for the web app |
| Task runner | **`just`** (`justfile`). No Makefile. |
| Python packages | **`uv`** (`pyproject.toml` + `uv.lock`). No pip or poetry. |
| Scheduling | `just` recipes triggered by a lightweight scheduler (cron in a container). **No Airflow.** |
| Monitoring | Logs plus data-quality and device-status tables. **No Prometheus or Grafana.** |

Open decision: the web frontend framework (keep it thin; all data comes from FastAPI).

## Rules for data and jobs

- Explicit schemas for all streaming reads. No schema inference.
- Every Spark job has a checkpoint location and writes idempotently (merge/upsert keyed on `device_id, metric, measured_at`).
- Keep lineage columns on every record: source topic/partition/offset, `ingested_at`, `batch_id`, `quality_flag`.
- Bad records go to a quarantine table. Jobs must not crash on malformed input.
- Cassandra tables are query-first (one table per API query). Readings tables use a TTL of about 24–48 h. Alert state is kept longer.
- Alerts follow the lifecycle open → acknowledged → resolved. Apply debounce and cooldown to avoid floods.
- Silver and gold are built only with dbt models (incremental where sensible). Every model has tests (not null, unique key, accepted ranges) and a description.
- Gold tables are partitioned by date. Schedule Iceberg compaction (`rewrite_data_files`, run through a dbt macro with `dbt run-operation`) to handle small files from streaming commits.
- Near real-time dashboards read **only** Cassandra. Intraday and daily dashboards read **only** Trino/gold. Don't mix sources inside one chart.
- Don't let the frontend or any client talk to Kafka, HDFS, Cassandra or Trino directly.

## Suggested repository layout

```
.
├── docker-compose.yml     # profiles: core, processing, serving, app
├── justfile               # up/down, run-stream, dbt-run, dbt-test, compact, test, bench
├── pyproject.toml         # dependencies, managed with uv
├── uv.lock
├── .env.example
├── simulator/             # LoRaWAN-style sensor and gateway payload generator, with fault injection
├── ingest/                # HTTP push receiver → Kafka producer
├── streaming/             # Spark micro-batch jobs (validation, Cassandra write, bronze write)
├── dbt/                   # dbt project (dbt-spark): silver and gold models, tests, compaction macros, quality summary
├── cassandra/             # CQL schema
├── api/                   # FastAPI app
├── web/                   # dashboards
├── benchmarks/            # scripts and results
└── docs/
```

## Conventions

- Python 3.11, type hints, `ruff` for lint and format.
- Manage dependencies with `uv` (`uv add`, `uv sync`, `uv run`). Commit `uv.lock`.
- Every routine task is a `just` recipe. Check `just --list` before adding a script, and keep recipes thin (call into code, don't embed logic).
- Configuration through environment variables. Never hard-code hosts or credentials, and never commit data files or secrets.
- `snake_case` for tables and columns. Timestamps in UTC.
- Mention the requirement ID (BR1–BR8, FR x.y) in commit messages and pull requests.
- Each requirement has a test that uses replayed or injected data and matches its acceptance criteria.

## Working rules for agents

1. Check `REQUIREMENTS.md` before building a feature, and don't add features outside it.
2. Keep each Compose profile runnable on its own where possible.
3. Do not introduce technologies outside the decisions table. Propose and justify first.
4. Benchmarks must record their configuration (trigger interval, data volume, hardware) with the results, because the evaluation section depends on them.
5. Prefer small, testable changes, and say clearly what was and wasn't verified.

## Benchmarks required for the report

1. Micro-batch trigger interval: 10 s / 30 s / 60 s
2. Cassandra vs Trino-on-Iceberg for the same dashboard query
3. Iceberg vs plain Hive/Parquet
4. Effect of compaction on query time
5. Recovery and replay tests (no loss, no duplicates)