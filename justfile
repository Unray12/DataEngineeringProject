# Task runner for the agriculture data engineering platform.
#
# `just` replaces `make` as the single entry point: every workflow is a recipe
# here, and each recipe shells out to Docker Compose. Run `just` to list them.
#
# Values from `.env` are loaded into the environment of every recipe (see
# `set dotenv-load`), so they are referenced as ${VAR}, not {{VAR}}.
#
# Docs: https://just.systems/man/en/

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

compose := "docker compose"
all-profiles := "--profile core --profile processing --profile serving"

# Show the recipe list
default:
    @just --list --unsorted

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------

# Create .env from the template
init:
    @test -f .env && { echo ".env already exists, leaving it alone"; exit 0; } || { cp .env.example .env; echo "created .env"; }

# Check that the required tooling is installed and Docker is reachable
doctor:
    @echo "==> just      $(just --version)"
    @echo "==> docker    $(docker --version)"
    @echo "==> compose   $(docker compose version --short)"
    @docker info >/dev/null
    @echo "==> docker daemon reachable"
    @test -f .env || { echo "ERROR: .env missing - run: just init"; exit 1; }
    @echo "==> .env present (COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME})"
    @echo "==> HDFS URI  ${HDFS_NAMENODE_URI}"

# Build every project image
build:
    {{compose}} --profile core --profile processing --profile serving build

# -----------------------------------------------------------------------------
# Lifecycle
# -----------------------------------------------------------------------------

# Start HDFS + Kafka + Hive Metastore + Trino + ingest
up-core:
    {{compose}} --profile core up -d --wait
    @just _hdfs-ready
    @just kafka-init
    @echo "core is up -> ingest :${INGEST_PORT}, Trino :${TRINO_PORT}, HMS :${HIVE_METASTORE_PORT}, Kafka :${KAFKA_EXTERNAL_PORT}, NameNode UI :${HDFS_NAMENODE_HTTP_PORT}"

# Build the Spark job runners (streaming, batch, dbt, tests) and the simulator
up-processing:
    {{compose}} --profile core up -d --wait
    {{compose}} --profile core --profile processing build

# Start Cassandra + FastAPI
up-serving:
    {{compose}} --profile core --profile serving up -d --wait
    @echo "serving is up -> http://localhost:${API_PORT}/docs"

# Start core, serving and processing profiles.
up:
    @just up-core
    @just up-serving
    @just up-processing
    @just _hdfs-ready
    @echo "all profiles are up -> API http://localhost:${API_PORT}/docs, ingress :${INGEST_PORT}"

# Stop all containers (volumes and lakehouse data are kept)
down:
    {{compose}} {{all-profiles}} down --remove-orphans

# Stop containers and DELETE all data (HDFS, Kafka topics, Cassandra, HMS schema)
clean:
    {{compose}} {{all-profiles}} down --remove-orphans --volumes

# Show container status
ps:
    {{compose}} {{all-profiles}} ps

# Tail the logs of one or more services, e.g. just logs spark-stream trino
logs *services:
    {{compose}} logs -f {{services}}

# -----------------------------------------------------------------------------
# HDFS
# -----------------------------------------------------------------------------

# Internal: block until HDFS answers and a DataNode has registered.
# The datanode check uses grep -c, not grep -q: -q exits on the first match and
# closes the pipe, which makes `docker compose exec` fail with EPIPE (255) and,
# under pipefail, turns the until-loop into an infinite one.
_hdfs-ready:
    @echo "==> waiting for HDFS"
    @until {{compose}} exec -T namenode hdfs dfs -ls / >/dev/null 2>&1; do sleep 2; done
    @until [ "$( {{compose}} exec -T datanode hdfs dfsadmin -report 2>/dev/null | grep -c 'Live datanodes')" -gt 0 ]; do sleep 2; done
    @echo "==> HDFS ready"

# List an HDFS path, default the root: just hdfs-ls /warehouse
hdfs-ls path="/":
    {{compose}} exec -T namenode hdfs dfs -ls -h "{{path}}"

# Show DataNode capacity and live block counts
hdfs-du:
    {{compose}} exec -T namenode hdfs dfsadmin -report

# Show the medallion warehouse layout
hdfs-warehouse:
    {{compose}} exec -T namenode hdfs dfs -ls -h ${HDFS_WAREHOUSE_PATH}

# RECREATE the filesystem: deletes every lakehouse table, checkpoint and Kafka topic
hdfs-format:
    @echo "!!! This deletes all HDFS data: lakehouse tables, checkpoints, Kafka topics"
    @read -r -p "Type 'reformat' to continue: " answer; \
      if [[ "$answer" != "reformat" ]]; then echo "aborted"; exit 1; fi
    {{compose}} --profile core --profile processing down --volumes
    {{compose}} --profile core up -d --wait
    @just _hdfs-ready

# Delete just the streaming checkpoints, keeping the data (forces a full replay)
streaming-reset:
    {{compose}} exec -T namenode hdfs dfs -rm -r -f ${HDFS_CHECKPOINTS_PATH} || true
    @echo "checkpoints deleted - the next run replays from ${STARTING_OFFSETS}"

# -----------------------------------------------------------------------------
# Kafka
# -----------------------------------------------------------------------------

# Create the sensor topic explicitly (auto-creation is also enabled)
kafka-init:
    {{compose}} exec -T kafka /opt/kafka/bin/kafka-topics.sh \
      --bootstrap-server ${KAFKA_BOOTSTRAP} \
      --create --if-not-exists --topic ${KAFKA_SENSOR_TOPIC} \
      --partitions ${KAFKA_TOPIC_PARTITIONS} --replication-factor 1

# List topics and their end offsets.
# Uses kafka-get-offsets.sh, not kafka.tools.GetOffsetShell: the old class is
# removed in Kafka 3.8+ (NoClassDefFoundError).
kafka-topics:
    {{compose}} exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server ${KAFKA_BOOTSTRAP} --list
    @{{compose}} exec -T kafka /opt/kafka/bin/kafka-get-offsets.sh \
      --bootstrap-server ${KAFKA_BOOTSTRAP} --topic ${KAFKA_SENSOR_TOPIC}

# Print the first 10 sensor events from the beginning of the topic
kafka-tail count="10":
    {{compose}} exec -T kafka /opt/kafka/bin/kafka-console-consumer.sh \
      --bootstrap-server ${KAFKA_BOOTSTRAP} --topic ${KAFKA_SENSOR_TOPIC} \
      --from-beginning --max-messages {{count}}

# Delete the sensor topic and recreate it empty (checkpoints must be reset too)
kafka-reset:
    {{compose}} exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server ${KAFKA_BOOTSTRAP} --delete --topic ${KAFKA_SENSOR_TOPIC} || true
    @just kafka-init

# -----------------------------------------------------------------------------
# Trino / Iceberg
# -----------------------------------------------------------------------------

# Run a Trino query: just trino-sql "SELECT count(*) FROM lakehouse.bronze.sensor_readings"
trino-sql query="SHOW SCHEMAS FROM lakehouse":
    {{compose}} exec -T trino trino --server localhost:8080 --user ${TRINO_USER} --execute "{{query}}"

# List the Iceberg tables registered in the Hive Metastore
lakehouse-tables:
    {{compose}} exec -T trino trino --server localhost:8080 --user ${TRINO_USER} \
      --execute "SELECT table_schema, table_name FROM lakehouse.information_schema.tables WHERE table_schema IN ('bronze','silver','gold','ops') ORDER BY 1, 2"

# Create the medallion namespaces in the Hive Metastore (idempotent)
lakehouse-init:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm spark-batch

# Drop every lakehouse table and database (destructive)
lakehouse-drop:
    {{compose}} --profile core --profile processing run --rm spark-batch python -m batch.iceberg_init --drop-all

# Compact small Iceberg files produced by streaming commits (run via dbt macro).
compact table="bronze.sensor_readings":
    {{compose}} --profile core --profile processing run --rm dbt \
      dbt run-operation rewrite_data_files --args '{table: {{table}}}' \
      --project-dir /app/dbt --profiles-dir /app/dbt

# -----------------------------------------------------------------------------
# Pipelines
# -----------------------------------------------------------------------------

# Run the Spark Structured Streaming micro-batch job in the foreground
run-stream trigger='' max_offsets='' reset_checkpoint='no':
    @just _hdfs-ready
    {{compose}} --profile core --profile processing --profile serving run --rm \
      -e TRIGGER_INTERVAL="{{trigger}}" \
      -e MAX_OFFSETS_PER_TRIGGER="{{max_offsets}}" \
      -e RESET_CHECKPOINT={{reset_checkpoint}} \
      spark-stream

# Run the streaming job detached; follow it with: just logs spark-stream.
# `compose up` has no -e flag, so overrides go through the shell environment
# (compose.yml interpolates ${TRIGGER_INTERVAL:-30s}; empty falls back).
run-stream-bg trigger='' max_offsets='':
    @just _hdfs-ready
    TRIGGER_INTERVAL="{{trigger}}" MAX_OFFSETS_PER_TRIGGER="{{max_offsets}}" \
      {{compose}} --profile core --profile processing --profile serving up -d spark-stream

# Stop the streaming job
stop-stream:
    {{compose}} --profile core --profile processing stop spark-stream
    {{compose}} --profile core --profile processing rm -f spark-stream

# Run the sensor simulator in the foreground; Ctrl-C to stop
run-simulator:
    {{compose}} --profile core --profile processing run --rm simulator

# Run the simulator for a fixed number of seconds: just sim-for 60
sim-for seconds="60":
    {{compose}} --profile core --profile processing run --rm -e SIM_DURATION_SECONDS={{seconds}} simulator

# Check the ingest service health and the topic end offsets
ingest-check:
    @{{compose}} exec -T ingest python -c \
      "import urllib.request; print(urllib.request.urlopen('http://localhost:8081/health').read().decode())"
    @{{compose}} exec -T kafka /opt/kafka/bin/kafka-get-offsets.sh \
      --bootstrap-server ${KAFKA_BOOTSTRAP} --topic ${KAFKA_SENSOR_TOPIC}

# Verify the streaming path end to end: Cassandra serving tables + bronze Iceberg
verify-pipeline:
    @just _cassandra-counts
    @just trino-sql "SELECT count(*) AS bronze_rows FROM lakehouse.bronze.sensor_readings"
    @just trino-sql "SELECT quality_flag, count(*) FROM lakehouse.bronze.sensor_readings GROUP BY 1 ORDER BY 2 DESC"
    @just trino-sql "SELECT reason, count(*) FROM lakehouse.ops.quarantine GROUP BY 1 ORDER BY 2 DESC"

# Internal: row counts of every Cassandra serving table
_cassandra-counts:
    @{{compose}} exec -T cassandra cqlsh -e "\
      SELECT count(*) AS latest_by_field FROM agri.latest_by_field; \
      SELECT count(*) AS series FROM agri.readings_by_field_24h; \
      SELECT count(*) AS device_status FROM agri.device_status; \
      SELECT count(*) AS alerts_by_field FROM agri.alerts_by_field; \
      SELECT status, count(*) FROM agri.alerts_by_status GROUP BY status;"

# -----------------------------------------------------------------------------
# dbt (bronze -> silver -> gold)
# -----------------------------------------------------------------------------

# Build the dbt silver and gold models
dbt-run:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm dbt dbt build --project-dir /app/dbt --profiles-dir /app/dbt

# dbt data-quality tests only
dbt-test:
    {{compose}} --profile core --profile processing run --rm dbt dbt test --project-dir /app/dbt --profiles-dir /app/dbt

# Generate the dbt documentation site
dbt-docs:
    {{compose}} --profile core --profile processing run --rm dbt dbt docs generate --project-dir /app/dbt --profiles-dir /app/dbt

# -----------------------------------------------------------------------------
# API
# -----------------------------------------------------------------------------

# Show the OpenAPI schema of the running API
api-docs:
    curl -s http://localhost:${API_PORT}/openapi.json | python3 -m json.tool | head -80

# Probe the API liveness and readiness endpoints
api-health:
    @curl -s http://localhost:${API_PORT}/health/live; echo
    @curl -s http://localhost:${API_PORT}/health/ready; echo

# -----------------------------------------------------------------------------
# Tests and quality
# -----------------------------------------------------------------------------

# Run the containerised test suite against the running stack
test:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm spark-tests

# Pure-Python unit tests (eval rules), no containers needed
test-unit:
    docker run --rm -v "${PWD}:/app" -w /app \
      -e PYTHONPATH=/app/src \
      python:3.11-slim sh -c "pip install -q pytest && pytest -q tests/unit"

# Lint with ruff
lint:
    docker run --rm -v "${PWD}:/app" -w /app python:3.11-slim \
      sh -c "pip install -q ruff==0.9.* && ruff check ."

# Format with ruff
fmt:
    docker run --rm -v "${PWD}:/app" -w /app python:3.11-slim \
      sh -c "pip install -q ruff==0.9.* && ruff format ."

# -----------------------------------------------------------------------------
# Benchmarks (AGENTS.md: results must record configuration)
#
# Deferred: the streaming path is verified, but the benchmark scripts that drive
# these are not written yet. Each recipe states the configuration it must record
# (trigger interval, data volume, hardware) when it is implemented.
# -----------------------------------------------------------------------------

# Micro-batch trigger interval: 10s / 30s / 60s (deferred)
bench-trigger interval="30s" duration="120":
    @echo "NOT IMPLEMENTED: trigger-interval sweep {{interval}} over {{duration}}s"
    @echo "implement benchmarks/run_trigger_benchmark.py (record trigger, volume, hardware)"

# Point lookups: Cassandra vs Trino-on-Iceberg (deferred)
bench-lookups:
    @echo "NOT IMPLEMENTED: Cassandra vs Trino for the same dashboard query"
    @echo "implement benchmarks/run_lookup_benchmark.py (record query, rows, hardware)"

# Iceberg vs plain Parquet on the same data (deferred)
bench-storage:
    @echo "NOT IMPLEMENTED: Iceberg vs plain Hive/Parquet"
    @echo "implement benchmarks/run_storage_benchmark.py (record schema, volume, hardware)"

# Effect of compaction on query time (deferred)
bench-compaction:
    @echo "NOT IMPLEMENTED: query time before/after rewrite_data_files"
    @echo "implement benchmarks/run_compaction_benchmark.py (record file counts, hardware)"

# Recovery and replay: no loss, no duplicates (deferred)
bench-replay:
    @echo "NOT IMPLEMENTED: kill/replay the streaming job, assert no loss/duplicates"
    @echo "implement benchmarks/run_replay_benchmark.py (record offsets, batch counts)"
