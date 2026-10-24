"""Iceberg table DDL for the streaming sinks (bronze + ops).

Bronze keeps every schema-valid reading, raw and flagged, forever (FR6.1); the
``ops`` namespace holds the operational tables the medallion ETL consumes:
quarantine (FR4.1), per-batch quality counters (FR4.5) and device gap records
(FR3.5). Silver and gold are deliberately absent: dbt builds those.

Every table is created idempotently at job start with an explicit schema
(AGENTS.md: no schema inference), and every write is a MERGE keyed on
``(device_id, metric, measured_at)`` (or on the Kafka offsets for quarantine),
so a replayed micro-batch updates rows in place instead of duplicating them
(FR3.3).
"""

from __future__ import annotations

from pyspark.sql import SparkSession

CATALOG = "lakehouse"

BRONZE_READINGS = f"{CATALOG}.bronze.sensor_readings"
OPS_QUARANTINE = f"{CATALOG}.ops.quarantine"
OPS_QUALITY_COUNTERS = f"{CATALOG}.ops.quality_counters"
OPS_DEVICE_GAPS = f"{CATALOG}.ops.device_gaps"

# Column order is the contract for "INSERT *" in the MERGE statements below.
BRONZE_COLUMNS = [
    "event_id",
    "device_id",
    "field_id",
    "farm_id",
    "crop_code",
    "metric",
    "value",
    "unit",
    "measured_at",
    "ingested_at",
    "is_late",
    "quality_flag",
    "source_topic",
    "source_partition",
    "source_offset",
    "batch_id",
    "simulated_fault",
]

QUARANTINE_COLUMNS = [
    "reason",
    "raw_payload",
    "event_id",
    "device_id",
    "metric",
    "reading_ts",
    "value_raw",
    "source_topic",
    "source_partition",
    "source_offset",
    "ingested_at",
    "detected_at",
    "batch_id",
]

QUALITY_COUNTER_COLUMNS = [
    "batch_id",
    "window_start",
    "window_end",
    "field_id",
    "device_id",
    "metric",
    "total",
    "valid",
    "duplicate",
    "null_value",
    "out_of_range",
    "implausible_jump",
    "late",
]

DEVICE_GAP_COLUMNS = [
    "field_id",
    "device_id",
    "gap_start",
    "gap_end",
    "duration_s",
    "detected_batch_id",
    "resolved_batch_id",
]

_DDL = [
    f"""
    CREATE NAMESPACE IF NOT EXISTS {CATALOG}.bronze
    """,
    f"""
    CREATE NAMESPACE IF NOT EXISTS {CATALOG}.ops
    """,
    f"""
    CREATE TABLE IF NOT EXISTS {BRONZE_READINGS} (
        event_id string,
        device_id string NOT NULL,
        field_id string NOT NULL,
        farm_id string NOT NULL,
        crop_code string NOT NULL,
        metric string NOT NULL,
        value double,
        unit string,
        measured_at timestamp NOT NULL,
        ingested_at timestamp,
        is_late boolean,
        quality_flag string NOT NULL,
        source_topic string,
        source_partition int,
        source_offset bigint,
        batch_id bigint,
        simulated_fault string
    )
    USING iceberg
    PARTITIONED BY (days(measured_at))
    TBLPROPERTIES ('format-version' = '2')
    """,
    f"""
    CREATE TABLE IF NOT EXISTS {OPS_QUARANTINE} (
        reason string NOT NULL,
        raw_payload string,
        event_id string,
        device_id string,
        metric string,
        reading_ts string,
        value_raw string,
        source_topic string NOT NULL,
        source_partition int NOT NULL,
        source_offset bigint NOT NULL,
        ingested_at timestamp,
        detected_at timestamp,
        batch_id bigint
    )
    USING iceberg
    PARTITIONED BY (days(detected_at))
    TBLPROPERTIES ('format-version' = '2')
    """,
    f"""
    CREATE TABLE IF NOT EXISTS {OPS_QUALITY_COUNTERS} (
        batch_id bigint NOT NULL,
        window_start timestamp,
        window_end timestamp,
        field_id string,
        device_id string NOT NULL,
        metric string NOT NULL,
        total int NOT NULL,
        valid int NOT NULL,
        duplicate int NOT NULL,
        null_value int NOT NULL,
        out_of_range int NOT NULL,
        implausible_jump int NOT NULL,
        late int NOT NULL
    )
    USING iceberg
    TBLPROPERTIES ('format-version' = '2')
    """,
    f"""
    CREATE TABLE IF NOT EXISTS {OPS_DEVICE_GAPS} (
        field_id string NOT NULL,
        device_id string NOT NULL,
        gap_start timestamp NOT NULL,
        gap_end timestamp,
        duration_s double,
        detected_batch_id bigint,
        resolved_batch_id bigint
    )
    USING iceberg
    TBLPROPERTIES ('format-version' = '2')
    """,
]


def ensure_tables(spark: SparkSession) -> None:
    """Create the bronze/ops namespaces and tables (idempotent)."""
    for statement in _DDL:
        spark.sql(statement)


def merge(
    spark: SparkSession,
    target: str,
    source_view: str,
    condition: str,
) -> None:
    """Idempotent merge/upsert (AGENTS.md rule for every Spark job, FR3.3).

    The source must be unique per match condition; callers de-duplicate first.
    """
    spark.sql(
        f"""
        MERGE INTO {target} AS t
        USING {source_view} AS s
        ON {condition}
        WHEN MATCHED THEN UPDATE SET *
        WHEN NOT MATCHED THEN INSERT *
        """
    )
