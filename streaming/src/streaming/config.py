"""Spark Structured Streaming micro-batch job (BR2, BR3, BR4, BR8).

Pipeline (30 s micro-batch, see AGENTS.md):

    Kafka ``sensor.readings.v1``
      -> explicit-schema parse + lineage capture (topic/partition/offset/ingested_at)
      -> device -> field -> farm resolution against master data (FR1.2)
      -> validation: schema, ranges, implausible jumps, de-duplication (FR4.1-4.3)
      -> Iceberg: bronze (raw, flagged), ops.quarantine, ops.quality_counters,
         ops.device_gaps                       (HDFS, full history, FR6)
      -> Cassandra: latest_by_field, readings_by_field_24h, device_status,
         alerts + alert lifecycle              (near real-time serving, FR2.2)

Silver and gold are **not** written here: they are built by dbt (AGENTS.md).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # keep this module importable without pyspark (unit tests, API)
    from pyspark.sql import DataFrame, SparkSession

# Spark's CalendarInterval parser (used by withWatermark and the processing-time
# trigger) does not accept single-letter units: "30s" fails, "30 seconds" works.
# Configuration stays human-friendly ("30s" in .env, the benchmark sweep), and
# this maps the shorthand to the form Spark accepts.
_INTERVAL_UNITS = {
    "ms": "milliseconds",
    "s": "seconds",
    "m": "minutes",
    "h": "hours",
    "d": "days",
}
_INTERVAL_RE = re.compile(r"^\s*(\d+)\s*([a-zA-Z]+)\s*$")


def spark_interval(value: str) -> str:
    """Normalise a duration to a Spark interval literal ('30s' -> '30 seconds')."""
    match = _INTERVAL_RE.match(value)
    if not match:
        return value
    amount, unit = match.groups()
    unit = _INTERVAL_UNITS.get(unit.lower(), unit.lower())
    return f"{amount} {unit}"


def env(key: str, default: str) -> str:
    import os

    value = os.environ.get(key)
    return default if value in (None, "") else value


def env_float(key: str, default: float) -> float:
    import os

    value = os.environ.get(key)
    return default if value in (None, "") else float(value)


def env_int(key: str, default: int) -> int:
    import os

    value = os.environ.get(key)
    return default if value in (None, "") else int(value)


@dataclass(frozen=True)
class StreamConfig:
    # Kafka
    bootstrap_servers: str
    topic: str
    starting_offsets: str
    max_offsets_per_trigger: int
    # Spark
    trigger_interval: str
    checkpoint_location: str
    master: str
    # Cassandra
    cassandra_contact_points: str
    cassandra_keyspace: str
    cassandra_wait_s: int
    # Master data
    reference_path: str
    # Quality rules (FR4.2)
    late_after_s: int
    # Alert rules (FR8.1, FR8.2, FR8.5)
    debounce_batches: int
    cooldown_s: int
    offline_multiplier: float
    battery_low_pct: float
    signal_poor_max: float

    @classmethod
    def from_env(cls) -> StreamConfig:
        namenode = env("HDFS_NAMENODE_URI", "hdfs://namenode:8020")
        checkpoint_root = env("CHECKPOINT_ROOT", "sensor_pipeline")
        checkpoint_uri = env("CHECKPOINT_URI", f"{namenode}{env('HDFS_CHECKPOINTS_PATH', '/checkpoints')}")
        return cls(
            bootstrap_servers=env("KAFKA_BOOTSTRAP", "kafka:29092"),
            topic=env("KAFKA_SENSOR_TOPIC", "sensor.readings.v1"),
            starting_offsets=env("STARTING_OFFSETS", "earliest"),
            max_offsets_per_trigger=env_int("MAX_OFFSETS_PER_TRIGGER", 20000),
            # Fixed decision (AGENTS.md): 30 s micro-batch. Benchmarks override it.
            trigger_interval=spark_interval(env("TRIGGER_INTERVAL", "30s")),
            checkpoint_location=f"{checkpoint_uri.rstrip('/')}/{checkpoint_root}",
            master=env("SPARK_MASTER", "local[*]"),
            cassandra_contact_points=env("CASSANDRA_CONTACT_POINTS", "cassandra:9042"),
            cassandra_keyspace=env("CASSANDRA_KEYSPACE", "agri"),
            cassandra_wait_s=env_int("CASSANDRA_WAIT_S", 180),
            reference_path=env("REFERENCE_DATA_PATH", "/app/reference/reference_data.json"),
            late_after_s=env_int("LATE_AFTER_S", 600),
            debounce_batches=env_int("ALERT_DEBOUNCE_BATCHES", 2),
            cooldown_s=env_int("ALERT_COOLDOWN_S", 300),
            offline_multiplier=env_float("DEVICE_OFFLINE_MULTIPLIER", 4.0),
            battery_low_pct=env_float("BATTERY_LOW_PCT", 20.0),
            signal_poor_max=env_float("SIGNAL_POOR_MAX", 0.3),
        )


# Explicit payload schema (AGENTS.md: no schema inference on streaming reads).
#
# Numeric fields arrive as strings so that a wrong JSON type ("value": "high")
# can be told apart from a genuine JSON null: the former is a malformed record
# (quarantined, FR4.1), the latter is a null measurement (flagged, FR4.2).
PAYLOAD_COLUMNS: dict[str, Any] = {
    "event_id": "string",
    "device_id": "string",
    "metric": "string",
    "value": "string",
    "reading_ts": "string",
    "battery_pct": "string",
    "signal_quality": "string",
    "simulated_fault": "string",
}


def read_stream(spark: SparkSession, cfg: StreamConfig) -> DataFrame:
    """Kafka source with explicit schema and full lineage columns (FR4.4).

    The Kafka stream is unioned with a Spark built-in ``rate`` source that
    emits one tick row per second. Spark does not run a micro-batch at all when
    no source has new offsets (and the query is stateless), so without the tick
    a silent topic would stop the 30 s trigger from ever evaluating outages
    (FR3.5) or alerts (FR8) - exactly what a fleet-wide silence looks like.
    Ticks carry no payload and are filtered out here, before validation, so no
    downstream stage ever sees them; they exist only to keep offsets advancing.
    """
    from pyspark.sql.functions import col, from_json, lit, try_to_timestamp
    from pyspark.sql.types import StringType, StructField, StructType

    schema = StructType([StructField(name, StringType(), True) for name in PAYLOAD_COLUMNS])
    raw = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", cfg.bootstrap_servers)
        .option("subscribe", cfg.topic)
        .option("startingOffsets", cfg.starting_offsets)
        .option("maxOffsetsPerTrigger", cfg.max_offsets_per_trigger)
        .load()
    )
    events = (
        raw.select(
            col("topic").alias("source_topic"),
            col("partition").cast("int").alias("source_partition"),
            col("offset").cast("long").alias("source_offset"),
            col("timestamp").alias("ingested_at"),
            col("value").cast("string").alias("raw_payload"),
            from_json(col("value").cast("string"), schema).alias("e"),
        )
        .select(
            col("source_topic"),
            col("source_partition"),
            col("source_offset"),
            col("ingested_at"),
            col("raw_payload"),
            # from_json returns a null struct when the payload is not JSON at all.
            col("e").isNotNull().alias("json_ok"),
            col("e").getItem("event_id").alias("event_id"),
            col("e").getItem("device_id").alias("device_id"),
            col("e").getItem("metric").alias("metric"),
            col("e").getItem("value").alias("value_raw"),
            col("e").getItem("reading_ts").alias("reading_ts"),
            col("e").getItem("battery_pct").alias("battery_raw"),
            col("e").getItem("signal_quality").alias("signal_raw"),
            col("e").getItem("simulated_fault").alias("simulated_fault"),
        )
        .withColumn("measured_at", try_to_timestamp(col("reading_ts")))
        .withColumn("is_tick", lit(False))
    )

    # Heartbeat side of the union: same columns, all payload nulls, so
    # unionByName matches by name and the filter below restores the exact
    # events schema the rest of the pipeline expects.
    payload_nulls = [
        lit(None).cast("string").alias(name)
        for name in (
            "event_id",
            "device_id",
            "metric",
            "value_raw",
            "reading_ts",
            "battery_raw",
            "signal_raw",
            "simulated_fault",
        )
    ]
    ticks = (
        spark.readStream.format("rate")
        .option("rowsPerSecond", 1)
        .load()
        .select(
            lit(None).cast("string").alias("source_topic"),
            lit(None).cast("int").alias("source_partition"),
            lit(None).cast("long").alias("source_offset"),
            col("timestamp").alias("ingested_at"),
            lit(None).cast("string").alias("raw_payload"),
            lit(False).alias("json_ok"),
            *payload_nulls,
            lit(None).cast("timestamp").alias("measured_at"),
            lit(True).alias("is_tick"),
        )
    )

    return (
        events.unionByName(ticks)
        .filter(~col("is_tick"))
        .drop("is_tick")
        # Late and out-of-order readings are accepted; the watermark documents
        # the configured lateness window (FR3.4) and bounds any future state.
        # Applied after the union: tick rows carry a null measured_at, which the
        # watermark ignores.
        .withWatermark("measured_at", f"{env_int('WATERMARK_S', 3600)} seconds")
    )
