# Every routine task of the platform. Run `just` to list them.
# Values from .env are exported to every recipe, so recipes use ${VAR}, not {{VAR}}.

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

compose := "docker compose"
all-profiles := "--profile core --profile processing --profile serving --profile app"

# Show the recipe list
default:
    @just --list --unsorted

# --- Preflight ---

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
    {{compose}} --profile core --profile processing --profile serving --profile app build

# --- Lifecycle ---

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

# --- HDFS ---

# grep -c, not grep -q: -q closes the pipe early, `docker compose exec` then fails with
# EPIPE and, under pipefail, the until-loop never ends.
# Block until HDFS answers and a DataNode has registered
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

# --- Kafka ---

# Create the sensor topic explicitly (auto-creation is also enabled)
kafka-init:
    {{compose}} exec -T kafka /opt/kafka/bin/kafka-topics.sh \
      --bootstrap-server ${KAFKA_BOOTSTRAP} \
      --create --if-not-exists --topic ${KAFKA_SENSOR_TOPIC} \
      --partitions ${KAFKA_TOPIC_PARTITIONS} --replication-factor 1

# (kafka.tools.GetOffsetShell no longer exists in Kafka 3.8+, hence kafka-get-offsets.sh)
# List topics and their end offsets
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

# --- Trino / Iceberg ---

# The query goes through stdin, so metadata tables work too:
#   just trino-sql 'SELECT snapshot_id, committed_at FROM lakehouse.gold."field_daily$snapshots"'
# Run a Trino query: just trino-sql "SELECT count(*) FROM lakehouse.bronze.sensor_readings"
trino-sql query="SHOW SCHEMAS FROM lakehouse":
    printf '%s\n' {{quote(query)}} | {{compose}} exec -T trino trino --server localhost:8080 --user ${TRINO_USER}

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

# --- Pipelines ---

# Run the Spark Structured Streaming micro-batch job in the foreground
run-stream trigger='' max_offsets='' reset_checkpoint='no':
    @just _hdfs-ready
    {{compose}} --profile core --profile processing --profile serving run --rm \
      -e TRIGGER_INTERVAL="{{trigger}}" \
      -e MAX_OFFSETS_PER_TRIGGER="{{max_offsets}}" \
      -e RESET_CHECKPOINT={{reset_checkpoint}} \
      spark-stream

# `compose up` has no -e flag, so overrides go through the shell environment (an empty value
# falls back to the compose default).
# Run the streaming job detached; follow it with: just logs spark-stream
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

# --- dbt (bronze -> silver -> gold) ---

# Build the dbt silver and gold models
dbt-run:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm dbt dbt build --project-dir /app/dbt --profiles-dir /app/dbt

# Needed after changing their partitioning or columns. Drops their snapshot history.
# Rebuild the incremental gold tables from scratch
dbt-full-refresh:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm dbt dbt build --full-refresh --select gold --project-dir /app/dbt --profiles-dir /app/dbt

# On ~12 GB of Docker memory, stop the stream first (two Spark drivers OOM-killed the NameNode).
# Batch flow: create tables, build and test silver/gold, compact bronze and ops
batch-run:
    @just lakehouse-init
    @just dbt-run
    @just dbt-test
    @just compact bronze.sensor_readings
    @just compact ops.quality_counters
    @just compact ops.quarantine
    @just compact ops.device_gaps

# Start the API and Next.js frontend against the processed lakehouse.
up-app:
    {{compose}} --profile core --profile serving --profile app up -d --wait api web
    @echo "web app is up -> http://localhost:${WEB_PORT:-3000}"

# dbt data-quality tests only
dbt-test:
    {{compose}} --profile core --profile processing run --rm dbt dbt test --project-dir /app/dbt --profiles-dir /app/dbt

# Generate the dbt documentation site
dbt-docs:
    {{compose}} --profile core --profile processing run --rm dbt dbt docs generate --project-dir /app/dbt --profiles-dir /app/dbt

# --- API ---

# Show the OpenAPI schema of the running API
api-docs:
    curl -s http://localhost:${API_PORT}/openapi.json | python3 -m json.tool | head -80

# Probe the API liveness and readiness endpoints
api-health:
    @curl -s http://localhost:${API_PORT}/health/live; echo
    @curl -s http://localhost:${API_PORT}/health/ready; echo

# --- Tests and quality ---

# Run the test suite inside the Spark image (needs the core profile running)
test:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm spark-tests

# Pure-Python unit tests (eval rules), no containers needed
test-unit:
    uv run pytest -q tests/unit

# Lint with ruff
lint:
    uv run ruff check .
    uv run ruff format --check .

# Format with ruff
fmt:
    uv run ruff format .

# --- Benchmarks ---
# Each script writes benchmarks/results/<name>.csv with its configuration in the first lines.
# #2-#4 run inside the api image; #1, #5 and #6 control containers, so they run on the host.

# Restarts spark-stream per interval and leaves it running at 30 s. About 35 min.
# Benchmark #1: trigger interval vs latency, alert latency, CPU and commits
bench-trigger triggers="10s,30s,60s" window="360":
    uv run python benchmarks/run_trigger_benchmark.py --triggers {{triggers}} --window {{window}}

# Hardware is detected here rather than in justfile variables, so other recipes never need Docker.
# Run a benchmark script inside the api image
_bench script *args:
    cpu=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m); \
    cores=$(sysctl -n hw.ncpu 2>/dev/null || nproc); \
    ram=$(( $(sysctl -n hw.memsize 2>/dev/null || awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo) / 1073741824 )); \
    docker_mem=$(docker info 2>/dev/null | awk '/Total Memory/ {print $3}' || true); \
    {{compose}} --profile core --profile serving run --rm --no-deps \
      -v "${PWD}/benchmarks:/app/benchmarks" \
      -e BENCH_HOST_CPU="$cpu" -e BENCH_HOST_CORES="$cores" \
      -e BENCH_HOST_RAM_GB="$ram" -e BENCH_DOCKER_MEM_GB="$docker_mem" \
      -e COMPACT_SECONDS \
      api python /app/benchmarks/{{script}} {{args}}

# Needs data in both stores (stream has run, then `just batch-run`).
# Benchmark #2: Cassandra vs Trino-on-Iceberg for the same dashboard query
bench-lookups:
    @just _bench run_lookup_benchmark.py

# Restart Trino once after adding trino/catalog/hive.properties.
# Benchmark #3: Iceberg vs plain Hive/Parquet on the same data
bench-storage:
    @just _bench run_storage_benchmark.py

# Benchmark #4: effect of compaction (rewrite_data_files through `just compact`) on file count and query time
bench-compaction:
    @just _bench run_compaction_benchmark.py --phase before
    start=$(date +%s); just compact bench.sensor_compaction; end=$(date +%s); \
      COMPACT_SECONDS=$((end - start)) just _bench run_compaction_benchmark.py --phase after

# About 35 min.
# Benchmark #5: kill or stop the stream mid-flow, restart, check every message landed once
bench-replay scenarios="sigkill,sigkill-after-bronze,stop" outage="180":
    uv run python benchmarks/run_replay_benchmark.py --scenarios {{scenarios}} --outage {{outage}}

# Run after `just batch-run`. --since <UTC time> limits the fault check to newer messages.
# Data checks: injected vs detected faults, gold vs silver, implausible values in gold
check-correctness *args:
    uv run python benchmarks/run_correctness_checks.py {{args}}

# Needs `just up-app`. Pages are timed as the HTML plus their /api/* calls in parallel.
# Benchmark #6: response time of every API endpoint and every page
bench-web *args:
    uv run python benchmarks/run_web_benchmark.py {{args}}
