"""Spark session with the Iceberg catalog on HDFS (Hive Metastore), shared by the stream and batch jobs."""

from __future__ import annotations

import os

from pyspark.sql import SparkSession


def build_spark(master: str | None = None) -> SparkSession:
    """Build a SparkSession wired to the Hive-backed Iceberg catalog (UTC)."""
    warehouse = os.getenv("HDFS_NAMENODE_URI", "hdfs://namenode:8020") + os.getenv(
        "HDFS_WAREHOUSE_PATH", "/warehouse"
    )
    builder = (
        SparkSession.builder.appName("agri-lakehouse")
        .master(master or os.getenv("SPARK_MASTER", "local[*]"))
        # UTC everywhere: timestamps must not depend on the container locale.
        .config("spark.sql.session.timeZone", "UTC")
        .config("spark.sql.shuffle.partitions", os.getenv("SPARK_SHUFFLE_PARTITIONS", "4"))
        .config("spark.sql.catalog.lakehouse", "org.apache.iceberg.spark.SparkCatalog")
        .config("spark.sql.catalog.lakehouse.catalog-impl", "org.apache.iceberg.hive.HiveCatalog")
        .config(
            "spark.sql.catalog.lakehouse.uri",
            os.getenv("HIVE_METASTORE_URI", "thrift://hive-metastore:9083"),
        )
        .config("spark.sql.catalog.lakehouse.warehouse", warehouse)
        .config("spark.sql.defaultCatalog", "lakehouse")
    )
    if os.getenv("SPARK_DRIVER_MEMORY"):
        builder = builder.config("spark.driver.memory", os.environ["SPARK_DRIVER_MEMORY"])
    if os.getenv("SPARK_DRIVER_CORES"):
        builder = builder.config("spark.driver.cores", os.environ["SPARK_DRIVER_CORES"])
    return builder.getOrCreate()
