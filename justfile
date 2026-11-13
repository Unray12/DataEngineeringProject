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
all-profiles := "--profile core --profile processing --profile serving --profile app"

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
    {{compose}} --profile core --profile processing --profile serving --profile app build

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
# The query goes through stdin, so Iceberg metadata tables work too:
#   just trino-sql 'SELECT snapshot_id, committed_at FROM lakehouse.gold."field_daily$snapshots"'
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

# Rebuild the incremental gold tables from scratch. Needed once after a change of their partitioning
# or columns: an existing table keeps its old layout and loses its Iceberg snapshot history.
dbt-full-refresh:
    @just _hdfs-ready
    {{compose}} --profile core --profile processing run --rm dbt dbt build --full-refresh --select gold --project-dir /app/dbt --profiles-dir /app/dbt

# Complete batch flow: initialize Iceberg tables, build silver/gold, test, then compact the tables
# the stream commits to every micro-batch (bronze and ops; ops.quality_counters gains a file per
# batch, and before compaction /quality/devices took 5x longer, benchmark #6).
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
    uv run pytest -q tests/unit

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
# Every script writes benchmarks/results/<name>.csv whose first lines record the
# configuration (trigger, data volume, hardware). #2-#4 only query the stores and run
# inside the api image; #1, #5 and #6 start, stop or kill containers (or time the
# published ports), so they run on the host with uv.
# -----------------------------------------------------------------------------

# Benchmark #1: micro-batch trigger interval (latency, alert latency, throughput, CPU/memory).
# Needs `just up`; restarts spark-stream per interval and leaves it running at 30 s. About 35 min.
bench-trigger triggers="10s,30s,60s" window="360":
    uv run python benchmarks/run_trigger_benchmark.py --triggers {{triggers}} --window {{window}}

# Run one benchmark script inside the api image on the Compose network. The scripts write
# benchmarks/results/*.csv, whose first lines record the configuration (AGENTS.md rule 4).
# Hardware is detected here, not in justfile variables, so other recipes never call `docker info`.
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

# Benchmark #2: Cassandra vs Trino-on-Iceberg for the same dashboard query (needs the stream
# running and `just batch-run` done, so both stores hold data)
bench-lookups:
    @just _bench run_lookup_benchmark.py

# Benchmark #3: Iceberg vs plain Hive/Parquet on the same data (restart Trino once after adding
# trino/catalog/hive.properties: `docker compose restart trino`)
bench-storage:
    @just _bench run_storage_benchmark.py

# Benchmark #4: effect of compaction (rewrite_data_files through `just compact`) on file count and query time
bench-compaction:
    @just _bench run_compaction_benchmark.py --phase before
    start=$(date +%s); just compact bench.sensor_compaction; end=$(date +%s); \
      COMPACT_SECONDS=$((end - start)) just _bench run_compaction_benchmark.py --phase after

# Benchmark #5: recovery and replay. SIGKILL the job mid-batch (and a normal stop) while the
# simulator keeps sending, restart on the same checkpoint, and check every Kafka message is in
# bronze or quarantine exactly once and every dashboard reading reached Cassandra. About 35 min.
bench-replay scenarios="sigkill,stop" outage="180":
    uv run python benchmarks/run_replay_benchmark.py --scenarios {{scenarios}} --outage {{outage}}

# Data-correctness checks of the evaluation (section 5.2): injected faults vs detected (Kafka as ground
# truth), gold field_daily recomputed from silver, implausible values in gold. Run after `just batch-run`.
check-correctness *args:
    uv run python benchmarks/run_correctness_checks.py {{args}}

# Benchmark #6: API endpoint and page response times (needs `just up-app`): every FastAPI endpoint,
# and every page as HTML plus its /api/* calls in parallel.
bench-web *args:
    uv run python benchmarks/run_web_benchmark.py {{args}}
