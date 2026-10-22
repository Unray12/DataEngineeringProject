"""Entry point: ``python -m streaming`` (run with ``just run-stream``)."""

from __future__ import annotations

import logging
import os
import sys

from pyspark.sql import SparkSession

from common.reference import load_reference
from streaming import ddl
from streaming.cassandra_io import CassandraWriter
from streaming.config import StreamConfig, read_stream
from streaming.pipeline import BatchProcessor
from streaming.spark import build_spark

log = logging.getLogger("streaming")


def reset_checkpoint(spark: SparkSession, location: str) -> None:
    """Delete the checkpoint directory (``just run-stream reset_checkpoint=yes``)."""
    path = spark._jvm.org.apache.hadoop.fs.Path(location)  # noqa: SLF001 (PySpark idiom)
    fs = path.getFileSystem(spark._jsc.hadoopConfiguration())  # noqa: SLF001
    if fs.exists(path):
        fs.delete(path, True)
        log.warning("deleted checkpoint %s; the next run replays from %s", location, "the start offsets")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-5s %(name)s - %(message)s",
        stream=sys.stdout,
    )
    cfg = StreamConfig.from_env()
    reference = load_reference(cfg.reference_path)
    log.info(
        "reference data: %d farms, %d fields, %d devices, %d metrics (%s)",
        len(reference.farms),
        len(reference.fields),
        len(reference.devices),
        len(reference.metrics),
        reference.path,
    )

    spark = build_spark(cfg.master)
    try:
        if os.getenv("RESET_CHECKPOINT", "no").lower() in {"yes", "true", "1"}:
            reset_checkpoint(spark, cfg.checkpoint_location)
        ddl.ensure_tables(spark)
        writer = CassandraWriter(cfg.cassandra_contact_points, cfg.cassandra_keyspace, cfg.cassandra_wait_s)
        processor = BatchProcessor(spark, cfg, reference, writer)
        query = (
            read_stream(spark, cfg)
            .writeStream.queryName("agri_sensor_stream")
            .foreachBatch(processor.process)
            .option("checkpointLocation", cfg.checkpoint_location)
            .trigger(processingTime=cfg.trigger_interval)
            .start()
        )
        log.info(
            "streaming started: topic=%s trigger=%s offsets=%s checkpoint=%s",
            cfg.topic,
            cfg.trigger_interval,
            cfg.starting_offsets,
            cfg.checkpoint_location,
        )
        query.awaitTermination()
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
