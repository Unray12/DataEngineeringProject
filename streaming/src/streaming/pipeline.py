"""Micro-batch orchestration: validate, persist and alert (BR2, BR3, BR4, BR8).

Each micro-batch runs these stages:

1. **Stage (Spark)** - resolve ``device_id`` against master data (FR1.2) and
   separate schema-invalid events into a quarantine reason (FR4.1).
2. **Read (Cassandra)** - previous ``latest_by_field`` value per (field, metric)
   (jump baseline + latest guard) and ``device_status`` per device (outages).
3. **Flag (Spark)** - de-duplicate on (device_id, metric, measured_at) (FR4.3),
   validate ranges and implausible jumps (FR4.2), mark late data (FR3.4).
4. **Persist (Iceberg/HDFS)** - MERGE bronze (raw, flagged), ops.quarantine,
   ops.quality_counters, ops.device_gaps. All merges are keyed so replays are
   idempotent (FR3.3).
5. **Serve (Cassandra)** - readings_by_field_24h (TTL 48 h) and
   latest_by_field for the near real-time dashboard (FR2.2), device_status,
   then the alert state machine: thresholds (FR8.1), outages (FR8.2) with
   debounce and cooldown (FR8.5) and automatic resolution (FR8.4).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql.types import (
    DoubleType,
    LongType,
    StringType,
    StructField,
    StructType,
    TimestampType,
)

from common.reference import Device, ReferenceData
from streaming import ddl
from streaming.alerts import (
    AlertConfig,
    AlertState,
    Condition,
    evaluate,
    new_alert_id,
    resolve_open_alert,
)
from streaming.alerts import (
    open_alert as mark_open,
)
from streaming.cassandra_io import CassandraWriter, DeviceStatus, utc_naive
from streaming.config import StreamConfig
from streaming.status import to_millis, transition

log = logging.getLogger("streaming.pipeline")

GAP_SCHEMA = StructType(
    [
        StructField("field_id", StringType(), False),
        StructField("device_id", StringType(), False),
        StructField("gap_start", TimestampType(), False),
        StructField("gap_end", TimestampType(), True),
        StructField("duration_s", DoubleType(), True),
        StructField("detected_batch_id", LongType(), True),
        StructField("resolved_batch_id", LongType(), True),
    ]
)


def _aware(value: datetime | None) -> datetime | None:
    """Cassandra hands back tz-naive UTC timestamps; normalise to aware UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class BatchProcessor:
    """Stateless per-batch processor; all durable state lives in Cassandra/HDFS."""

    def __init__(
        self,
        spark: SparkSession,
        cfg: StreamConfig,
        reference: ReferenceData,
        writer: CassandraWriter,
    ) -> None:
        self.spark = spark
        self.cfg = cfg
        self.ref = reference
        self.writer = writer
        self.alert_cfg = AlertConfig(debounce_batches=cfg.debounce_batches, cooldown_s=cfg.cooldown_s)

        # Static maps (master data) resolved once; Spark broadcasts them.
        self.device_field = self._map([(d.device_id, d.field_id) for d in reference.devices.values()])
        self.device_metrics = self._map([(d.device_id, list(d.metrics)) for d in reference.devices.values()])
        self.field_farm = self._map([(f.field_id, f.farm_id) for f in reference.fields.values()])
        self.field_crop = self._map([(f.field_id, f.crop_code) for f in reference.fields.values()])
        self.metric_unit = self._map([(m.metric, m.unit) for m in reference.metrics.values()])
        self.metric_min = self._map([(m.metric, m.min) for m in reference.metrics.values()])
        self.metric_max = self._map([(m.metric, m.max) for m in reference.metrics.values()])
        self.metric_jump = self._map([(m.metric, m.max_jump) for m in reference.metrics.values()])

    @staticmethod
    def _map(pairs: list[tuple[object, object]]):
        literals: list = []
        for key, value in pairs:
            literals.append(F.lit(key))
            literals.append(F.lit(value))
        return F.create_map(*literals)

    # ------------------------------------------------------------------
    # micro-batch entry point
    # ------------------------------------------------------------------

    def process(self, batch: DataFrame, batch_id: int) -> None:
        started = datetime.now(UTC)
        batch.persist()
        try:
            self._process(batch, batch_id, started)
        finally:
            batch.unpersist()

    def _process(self, batch: DataFrame, batch_id: int, started: datetime) -> None:
        # -- stage 1: structural validation + master-data resolution ------
        staged = self._stage(batch)
        quarantine_df = staged.filter(F.col("quarantine_reason").isNotNull())
        valid_df = staged.filter(F.col("quarantine_reason").isNull())

        touched = valid_df.select("field_id", "metric", "device_id").distinct().collect()
        field_metrics = sorted({(row.field_id, row.metric) for row in touched})
        fields = sorted({row.field_id for row in touched})

        # -- stage 2: reads that the quality flags and outages need --------
        prev_latest = {key: self.writer.read_latest(*key) for key in field_metrics}
        prev_status = self.writer.read_device_status(list(self.ref.devices))

        # -- stage 3: dedup, range/jump validation, lateness --------------
        flagged = self._flag(valid_df, prev_latest)

        # -- stage 4: Iceberg sinks (bronze + ops) -------------------------
        quarantine_counts = self._quarantine_counts(quarantine_df)
        self._write_quarantine(quarantine_df, batch_id, started)
        flag_counts = self._write_bronze_and_counters(flagged, batch_id, started)

        series_rows, latest_rows = self._collect_serving_rows(flagged, prev_latest, batch_id, started)
        device_rows = self._device_aggregates(flagged)
        device_count = device_rows.count()

        # -- stage 5: Cassandra serving tables -----------------------------
        self.writer.write_series(series_rows)
        self.writer.write_latest(latest_rows)

        offline_devices, resumed_devices = self._update_device_status(
            device_rows, prev_status, batch_id, started
        )

        # -- stage 6: alerts (thresholds, device health, outages) ----------
        conditions = self._build_conditions(flagged, device_rows, prev_status, offline_devices, started)
        opened, resolved = self._apply_conditions(conditions, fields, batch_id, started)

        events = sum(flag_counts.values()) + sum(quarantine_counts.values())
        log.info(
            "batch %d: events=%d quarantined=%s flags=%s series=%d latest=%d "
            "devices=%d offline=%d resumed=%d alerts(opened=%d resolved=%d) in %.1fs",
            batch_id,
            events,
            quarantine_counts,
            flag_counts,
            len(series_rows),
            len(latest_rows),
            device_count,
            len(offline_devices),
            len(resumed_devices),
            opened,
            resolved,
            (datetime.now(UTC) - started).total_seconds(),
        )

    # ------------------------------------------------------------------
    # stage 1: structural validation (FR4.1) + resolution (FR1.2)
    # ------------------------------------------------------------------

    def _stage(self, batch: DataFrame) -> DataFrame:
        value = F.expr("try_cast(value_raw AS double)")
        battery = F.expr("try_cast(battery_raw AS double)")
        signal = F.expr("try_cast(signal_raw AS double)")
        blank_device = F.col("device_id").isNull() | (F.length(F.trim(F.col("device_id"))) == 0)
        blank_metric = F.col("metric").isNull() | (F.length(F.trim(F.col("metric"))) == 0)
        blank_ts = F.col("reading_ts").isNull() | (F.length(F.trim(F.col("reading_ts"))) == 0)
        reason = (
            F.when(~F.col("json_ok"), F.lit("invalid_json"))
            .when(blank_device, F.lit("missing_field"))
            .when(blank_metric, F.lit("missing_field"))
            .when(blank_ts, F.lit("missing_field"))
            .when(F.col("measured_at").isNull(), F.lit("invalid_timestamp"))
            .when(F.col("value_raw").isNotNull() & value.isNull(), F.lit("malformed_value"))
            .when(F.col("resolved_field_id").isNull(), F.lit("unknown_device"))
            .when(
                ~F.array_contains(self.device_metrics[F.col("device_id")], F.col("metric")),
                F.lit("unexpected_metric"),
            )
            .otherwise(F.lit(None).cast("string"))
        )
        return (
            batch.withColumn("resolved_field_id", self.device_field[F.col("device_id")])
            .withColumn("field_id", F.col("resolved_field_id"))
            .withColumn("farm_id", self.field_farm[F.col("resolved_field_id")])
            .withColumn("crop_code", self.field_crop[F.col("resolved_field_id")])
            .withColumn("unit", self.metric_unit[F.col("metric")])
            .withColumn("value", value)
            .withColumn("battery_pct", battery)
            .withColumn("signal_quality", signal)
            .withColumn("quarantine_reason", reason)
            .drop("resolved_field_id")
        )

    # ------------------------------------------------------------------
    # stage 3: quality flags (FR4.2, FR4.3, FR3.4, FR4.6)
    # ------------------------------------------------------------------

    def _flag(self, valid: DataFrame, prev_latest: dict) -> DataFrame:
        baseline_value = self._map(
            [
                (f"{field}|{metric}", row.value if row else None)
                for (field, metric), row in prev_latest.items()
            ]
        ).cast("map<string,double>")
        key = F.concat_ws("|", F.col("field_id"), F.col("metric"))
        dedup_window = Window.partitionBy("device_id", "metric", "measured_at").orderBy(
            F.col("source_offset")
        )
        jump_delta = F.abs(F.col("value") - baseline_value[key])
        quality = (
            F.when(F.col("dup_rank") > 1, F.lit("duplicate"))
            .when(F.col("value").isNull(), F.lit("null_value"))
            .when(
                (F.col("value") < self.metric_min[F.col("metric")])
                | (F.col("value") > self.metric_max[F.col("metric")]),
                F.lit("out_of_range"),
            )
            .when(jump_delta > self.metric_jump[F.col("metric")], F.lit("implausible_jump"))
            .otherwise(F.lit("ok"))
        )
        late_bound = F.col("ingested_at") - F.expr(f"INTERVAL {self.cfg.late_after_s} SECONDS")
        return (
            valid.withColumn("dup_rank", F.row_number().over(dedup_window))
            .withColumn("jump_delta", F.when(F.col("value").isNotNull(), jump_delta))
            .withColumn("is_late", F.col("measured_at") < late_bound)
            .withColumn("quality_flag", quality)
        )

    # ------------------------------------------------------------------
    # stage 4: Iceberg sinks (FR6.1, FR3.3, FR3.5, FR4.5)
    # ------------------------------------------------------------------

    def _write_quarantine(self, quarantine_df: DataFrame, batch_id: int, now: datetime) -> None:
        if quarantine_df.rdd.isEmpty():
            return
        source = quarantine_df.select(
            F.col("quarantine_reason").alias("reason"),
            F.col("raw_payload"),
            F.col("event_id"),
            F.col("device_id"),
            F.col("metric"),
            F.col("reading_ts"),
            F.col("value_raw"),
            F.col("source_topic"),
            F.col("source_partition"),
            F.col("source_offset"),
            F.col("ingested_at"),
            F.col("ingested_at").alias("detected_at"),  # deterministic: replays produce identical rows
            F.lit(batch_id).cast("long").alias("batch_id"),
        )
        source.createOrReplaceTempView("src_quarantine")
        ddl.merge(
            source.sparkSession,
            ddl.OPS_QUARANTINE,
            "src_quarantine",
            "t.source_topic = s.source_topic AND t.source_partition = s.source_partition "
            "AND t.source_offset = s.source_offset",
        )

    def _write_bronze_and_counters(self, flagged: DataFrame, batch_id: int, now: datetime) -> dict[str, int]:
        flag_counts = {
            row["quality_flag"]: row["count"] for row in flagged.groupBy("quality_flag").count().collect()
        }
        if not flag_counts:
            return {}

        # Bronze: one row per (device_id, metric, measured_at); duplicates are
        # collapsed here (FR4.3) and counted in ops.quality_counters (FR4.5).
        bronze = (
            flagged.filter(F.col("dup_rank") == 1)
            .withColumn("batch_id", F.lit(batch_id).cast("long"))
            .select(*ddl.BRONZE_COLUMNS)
        )
        bronze.createOrReplaceTempView("src_bronze")
        ddl.merge(
            bronze.sparkSession,
            ddl.BRONZE_READINGS,
            "src_bronze",
            "t.device_id = s.device_id AND t.metric = s.metric AND t.measured_at = s.measured_at",
        )

        counters = flagged.groupBy("field_id", "device_id", "metric").agg(
            F.count("*").cast("int").alias("total"),
            F.sum((F.col("quality_flag") == "ok").cast("int")).alias("valid"),
            F.sum((F.col("quality_flag") == "duplicate").cast("int")).alias("duplicate"),
            F.sum((F.col("quality_flag") == "null_value").cast("int")).alias("null_value"),
            F.sum((F.col("quality_flag") == "out_of_range").cast("int")).alias("out_of_range"),
            F.sum((F.col("quality_flag") == "implausible_jump").cast("int")).alias("implausible_jump"),
            F.sum(F.col("is_late").cast("int")).alias("late"),
            F.min("measured_at").alias("window_start"),
            F.max("measured_at").alias("window_end"),
        )
        counters = counters.withColumn("batch_id", F.lit(batch_id).cast("long")).select(
            *ddl.QUALITY_COUNTER_COLUMNS
        )
        counters.createOrReplaceTempView("src_counters")
        ddl.merge(
            counters.sparkSession,
            ddl.OPS_QUALITY_COUNTERS,
            "src_counters",
            "t.batch_id = s.batch_id AND t.device_id = s.device_id AND t.metric = s.metric",
        )
        return flag_counts

    # ------------------------------------------------------------------
    # stage 5: Cassandra serving tables (FR2.2, FR2.3, FR3.5)
    # ------------------------------------------------------------------

    def _collect_serving_rows(
        self, flagged: DataFrame, prev_latest: dict, batch_id: int, now: datetime
    ) -> tuple[list[tuple], list[tuple]]:
        """Rows visible to the near real-time dashboard (FR4.6: invalid data is
        excluded, implausible jumps are carried with a visible quality flag)."""
        rows = (
            flagged.filter(F.col("quality_flag").isin("ok", "implausible_jump"))
            .select(
                "field_id",
                "metric",
                "device_id",
                "farm_id",
                "value",
                "unit",
                "measured_at",
                "ingested_at",
                "quality_flag",
                "source_topic",
                "source_partition",
                "source_offset",
            )
            .collect()
        )
        series: list[tuple] = []
        latest: list[tuple] = []
        for row in rows:
            measured_at = _aware(row.measured_at)
            ingested_at = _aware(row.ingested_at)
            bucket = int(measured_at.timestamp() // 3600)
            series.append(
                (
                    row.field_id,
                    row.metric,
                    bucket,
                    utc_naive(measured_at),
                    row.device_id,
                    float(row.value) if row.value is not None else None,
                    row.unit,
                    utc_naive(ingested_at),
                    row.quality_flag,
                    batch_id,
                )
            )
            previous = prev_latest.get((row.field_id, row.metric))
            if previous is None or measured_at > _aware(previous.measured_at):
                latest.append(
                    (
                        row.field_id,
                        row.metric,
                        row.farm_id,
                        row.device_id,
                        float(row.value) if row.value is not None else None,
                        row.unit,
                        utc_naive(measured_at),
                        utc_naive(ingested_at),
                        row.quality_flag,
                        batch_id,
                        row.source_topic,
                        row.source_partition,
                        row.source_offset,
                        utc_naive(now),
                    )
                )
        return series, latest

    def _device_aggregates(self, flagged: DataFrame) -> DataFrame:
        """Per-device battery/signal/last-seen for device_status and health alerts."""
        return (
            flagged.filter(F.col("dup_rank") == 1)
            .groupBy("device_id")
            .agg(
                F.max("field_id").alias("field_id"),
                F.max("farm_id").alias("farm_id"),
                F.max("battery_pct").alias("battery_pct"),
                F.avg("signal_quality").alias("signal_quality"),
                F.max("measured_at").alias("last_seen"),
                F.min("measured_at").alias("first_seen"),
            )
        )

    def _update_device_status(
        self,
        device_rows: DataFrame,
        prev_status: dict[str, DeviceStatus],
        batch_id: int,
        now: datetime,
    ) -> tuple[list[Device], list[Device]]:
        """Update device_status, detect outages and record gap rows (FR3.5, FR8.2)."""
        resumed: list[Device] = []
        offline: list[Device] = []

        aggregates = {row.device_id: row for row in device_rows.collect()}

        for device in self.ref.devices.values():
            previous = prev_status.get(device.device_id)
            aggregate = aggregates.get(device.device_id)
            decision = transition(
                previous_status=previous.status if previous else None,
                previous_last_seen=_aware(previous.last_seen) if previous else None,
                previous_gap_start=_aware(previous.gap_start) if previous else None,
                previous_gap_end=_aware(previous.gap_end) if previous else None,
                batch_first_seen=_aware(aggregate.first_seen) if aggregate is not None else None,
                batch_last_seen=_aware(aggregate.last_seen) if aggregate is not None else None,
                now=now,
                offline_after_s=self.ref.offline_after_s(device, self.cfg.offline_multiplier),
            )
            if decision.status is None:
                # Brand-new device that has never reported; nothing to judge yet.
                continue

            status = DeviceStatus(
                device_id=device.device_id,
                field_id=device.field_id,
                farm_id=self.ref.fields[device.field_id].farm_id,
                reporting_interval_s=device.reporting_interval_s,
                status=decision.status,
                last_seen=decision.last_seen,
                battery_pct=previous.battery_pct if previous else None,
                signal_quality=previous.signal_quality if previous else None,
                low_battery=previous.low_battery if previous else False,
                poor_signal=previous.poor_signal if previous else False,
                gap_start=decision.gap_start,
                gap_end=decision.gap_end,
            )
            if aggregate is not None:
                battery = aggregate.battery_pct
                signal = aggregate.signal_quality
                status.battery_pct = float(battery) if battery is not None else status.battery_pct
                status.signal_quality = float(signal) if signal is not None else status.signal_quality
                status.low_battery = (
                    status.battery_pct is not None and status.battery_pct <= self.cfg.battery_low_pct
                )
                status.poor_signal = (
                    status.signal_quality is not None and status.signal_quality < self.cfg.signal_poor_max
                )

            if decision.offline:
                offline.append(device)
            # Both can fire in one batch: late readings close the old gap, then
            # the silence check reopens one at the newest known reading.
            if decision.resume_gap is not None:
                gap_open, gap_close = decision.resume_gap
                self._write_gap(device, gap_open, gap_close, batch_id)
                resumed.append(device)
            if decision.went_offline:
                self._write_gap(device, decision.gap_start, None, batch_id)

            self.writer.write_device_status(status, batch_id, now)
        return offline, resumed

    def _write_gap(
        self, device: Device, gap_start: datetime | None, gap_end: datetime | None, batch_id: int
    ) -> None:
        # Millisecond precision on both ends: the MERGE key must survive the
        # Cassandra device_status round-trip (see status.to_millis).
        gap_start = to_millis(gap_start)
        gap_end = to_millis(gap_end)
        if gap_start is None:
            return
        duration = None
        if gap_end is not None:
            duration = (gap_end - gap_start).total_seconds()
        rows = [
            (
                device.field_id,
                device.device_id,
                utc_naive(gap_start),
                utc_naive(gap_end),
                duration,
                batch_id,
                batch_id if gap_end is not None else None,
            )
        ]
        self.spark.createDataFrame(rows, GAP_SCHEMA).createOrReplaceTempView("src_gaps")
        ddl.merge(
            self.spark,
            ddl.OPS_DEVICE_GAPS,
            "src_gaps",
            "t.device_id = s.device_id AND t.gap_start = s.gap_start",
        )

    # ------------------------------------------------------------------
    # stage 6: alerts (FR8.1, FR8.2, FR8.4, FR8.5)
    # ------------------------------------------------------------------

    def _build_conditions(
        self,
        flagged: DataFrame,
        device_rows: DataFrame,
        prev_status: dict[str, DeviceStatus],
        offline_devices: list[Device],
        now: datetime,
    ) -> list[Condition]:
        conditions: list[Condition] = []

        # Crop-threshold conditions on this batch's valid values (FR8.1).
        stats = {
            (row.field_id, row.metric): row
            for row in flagged.filter(F.col("quality_flag") == "ok")
            .groupBy("field_id", "metric")
            .agg(F.avg("value").alias("avg_value"), F.max("device_id").alias("device_id"))
            .collect()
        }
        for (field_id, metric), row in sorted(stats.items()):
            field = self.ref.field(field_id)
            crop = self.ref.crop(field.crop_code) if field else None
            target = crop.target(metric) if crop else None
            if target is None or row.avg_value is None:
                continue
            avg_value = float(row.avg_value)
            unit = self.ref.metrics[metric].unit
            if target.alert_below is not None and avg_value < target.alert_below:
                conditions.append(
                    Condition(
                        field_id=field_id,
                        condition_code="low_soil_moisture" if metric == "soil_moisture" else f"low_{metric}",
                        alert_type="low soil moisture" if metric == "soil_moisture" else f"low {metric}",
                        severity="warning",
                        breaching=True,
                        message=(
                            f"{metric.replace('_', ' ').title()} below the target range in {field_id}: "
                            f"{avg_value:.1f} {unit} < {target.alert_below:.1f} {unit}"
                        ),
                        metric=metric,
                        device_id=row.device_id,
                        crop_code=crop.crop_code,
                        observed_value=avg_value,
                        threshold_value=target.alert_below,
                    )
                )
            elif target.alert_above is not None and avg_value > target.alert_above:
                conditions.append(
                    Condition(
                        field_id=field_id,
                        condition_code="heat_stress" if metric == "air_temperature" else f"high_{metric}",
                        alert_type="heat stress" if metric == "air_temperature" else f"high {metric}",
                        severity="critical",
                        breaching=True,
                        message=(
                            f"{metric.replace('_', ' ').title()} above the target range in {field_id}: "
                            f"{avg_value:.1f} {unit} > {target.alert_above:.1f} {unit}"
                        ),
                        metric=metric,
                        device_id=row.device_id,
                        crop_code=crop.crop_code,
                        observed_value=avg_value,
                        threshold_value=target.alert_above,
                    )
                )
            else:
                # Condition met: still evaluated, so an open alert resolves (FR8.4).
                conditions.append(
                    Condition(
                        field_id=field_id,
                        condition_code="low_soil_moisture" if metric == "soil_moisture" else f"low_{metric}",
                        alert_type="low soil moisture" if metric == "soil_moisture" else f"low {metric}",
                        severity="warning",
                        breaching=False,
                        message="",
                        metric=metric,
                        device_id=row.device_id,
                        crop_code=crop.crop_code,
                        observed_value=avg_value,
                        threshold_value=target.alert_below,
                    )
                )

        # Implausible jumps (FR4.2) raise an informational alert once debounced.
        jumps = {
            (row.field_id, row.metric): row
            for row in flagged.filter(F.col("quality_flag") == "implausible_jump")
            .groupBy("field_id", "metric")
            .agg(F.max("jump_delta").alias("max_delta"), F.max("device_id").alias("device_id"))
            .collect()
        }
        for (field_id, metric), row in sorted(jumps.items()):
            max_jump = self.ref.metrics[metric].max_jump
            conditions.append(
                Condition(
                    field_id=field_id,
                    condition_code=f"rapid_change:{metric}",
                    alert_type="rapid change",
                    severity="info",
                    breaching=True,
                    message=(
                        f"Implausible jump in {metric} at {field_id}: "
                        f"{float(row.max_delta):.1f} within one batch (max step {max_jump:.1f})"
                    ),
                    metric=metric,
                    device_id=row.device_id,
                    crop_code=self.ref.field(field_id).crop_code if self.ref.field(field_id) else None,
                    observed_value=float(row.max_delta),
                    threshold_value=max_jump,
                )
            )

        # Device health conditions (FR8.2).
        for aggregate in device_rows.collect():
            device = self.ref.device(aggregate.device_id)
            if device is None:
                continue
            if aggregate.battery_pct is not None:
                battery = float(aggregate.battery_pct)
                conditions.append(
                    Condition(
                        field_id=device.field_id,
                        condition_code=f"battery_low:{device.device_id}",
                        alert_type="low battery",
                        severity="warning",
                        breaching=battery <= self.cfg.battery_low_pct,
                        message=f"Battery low on {device.device_id}: {battery:.0f}% "
                        f"(threshold {self.cfg.battery_low_pct:.0f}%)",
                        device_id=device.device_id,
                        observed_value=battery,
                        threshold_value=self.cfg.battery_low_pct,
                    )
                )
            if aggregate.signal_quality is not None:
                signal = float(aggregate.signal_quality)
                conditions.append(
                    Condition(
                        field_id=device.field_id,
                        condition_code=f"signal_poor:{device.device_id}",
                        alert_type="poor signal",
                        severity="info",
                        breaching=signal < self.cfg.signal_poor_max,
                        message=f"Signal quality poor on {device.device_id}: {signal:.2f} "
                        f"(threshold {self.cfg.signal_poor_max:.2f})",
                        device_id=device.device_id,
                        observed_value=signal,
                        threshold_value=self.cfg.signal_poor_max,
                    )
                )

        # Outage condition per device (FR8.2): evaluated for every device of the
        # reference data each batch, so silence is caught even when a whole
        # field goes quiet.
        offline_ids = {device.device_id for device in offline_devices}
        for device in self.ref.devices.values():
            previous = prev_status.get(device.device_id)
            last_seen = _aware(previous.last_seen) if previous else None
            threshold = self.ref.offline_after_s(device, self.cfg.offline_multiplier)
            silence = (now - last_seen).total_seconds() if last_seen else 0.0
            conditions.append(
                Condition(
                    field_id=device.field_id,
                    condition_code=f"device_offline:{device.device_id}",
                    alert_type="device offline",
                    severity="warning",
                    breaching=device.device_id in offline_ids,
                    message=f"Device {device.device_id} in {device.field_id} silent for "
                    f"{silence:.0f}s (threshold {threshold:.0f}s)",
                    device_id=device.device_id,
                    observed_value=silence,
                    threshold_value=threshold,
                )
            )

        return conditions

    def _apply_conditions(
        self, conditions: list[Condition], fields: list[str], batch_id: int, now: datetime
    ) -> tuple[int, int]:
        opened = 0
        resolved = 0
        states: dict[str, dict[str, AlertState]] = {}
        for condition in conditions:
            field_states = states.setdefault(condition.field_id, self._load_states(condition.field_id))
            state = field_states.setdefault(
                condition.condition_code,
                AlertState(field_id=condition.field_id, condition_code=condition.condition_code),
            )
            decision = evaluate(condition, state, now, self.alert_cfg)
            if decision.resolve_alert and state.open_alert_id and state.open_created_at:
                self.writer.resolve_alert(
                    alert_id=state.open_alert_id,
                    field_id=condition.field_id,
                    created_at=state.open_created_at,
                    old_status=state.open_status or "open",
                    resolved_by="streaming",
                    resolution="condition_cleared",
                )
                resolve_open_alert(state)
                resolved += 1
            if decision.emit_alert:
                alert_id = new_alert_id()
                self.writer.open_alert(
                    alert_id=alert_id,
                    created_at=now,
                    field_id=condition.field_id,
                    condition_code=condition.condition_code,
                    alert_type=condition.alert_type,
                    severity=condition.severity,
                    message=condition.message,
                    crop_code=condition.crop_code,
                    device_id=condition.device_id,
                    metric=condition.metric,
                    observed_value=condition.observed_value,
                    threshold_value=condition.threshold_value,
                    batch_id=batch_id,
                )
                mark_open(state, alert_id, now)
                opened += 1
            self.writer.write_alert_state(
                field_id=condition.field_id,
                condition_code=condition.condition_code,
                debounce_count=state.debounce_count,
                last_emitted_at=state.last_emitted_at,
                open_alert_id=state.open_alert_id,
                open_created_at=state.open_created_at,
                open_status=state.open_status,
                last_observed_value=state.last_observed_value,
                threshold_value=state.threshold_value,
                device_id=state.device_id,
                batch_id=batch_id,
                now=now,
            )
        return opened, resolved

    def _load_states(self, field_id: str) -> dict[str, AlertState]:
        states: dict[str, AlertState] = {}
        for code, row in self.writer.read_alert_states(field_id).items():
            states[code] = AlertState(
                field_id=field_id,
                condition_code=code,
                debounce_count=row.get("debounce_count") or 0,
                last_emitted_at=_aware(row.get("last_emitted_at")),
                open_alert_id=row.get("open_alert_id"),
                open_created_at=_aware(row.get("open_created_at")),
                open_status=row.get("open_status"),
                last_observed_value=row.get("last_observed_value"),
                threshold_value=row.get("threshold_value"),
                device_id=row.get("device_id"),
                last_batch_id=row.get("last_batch_id"),
            )
        return states

    @staticmethod
    def _quarantine_counts(quarantine_df: DataFrame) -> dict[str, int]:
        return {
            row["quarantine_reason"]: row["count"]
            for row in quarantine_df.groupBy("quarantine_reason").count().collect()
        }
