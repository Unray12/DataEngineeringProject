"""Create the lakehouse namespaces and load the crop targets (``just lakehouse-init``).

python -m batch.iceberg_init            # create namespaces and load crop targets
python -m batch.iceberg_init --drop-all # drop every lakehouse table first
"""

from __future__ import annotations

import argparse
import logging

from common.reference import ReferenceData, load_reference
from streaming.spark import build_spark

log = logging.getLogger("batch.iceberg_init")

NAMESPACES = ("bronze", "silver", "gold", "ops")
CATALOG = "lakehouse"
CROP_TARGETS = f"{CATALOG}.ops.crop_targets"

CROP_TARGETS_DDL = f"""
CREATE TABLE IF NOT EXISTS {CROP_TARGETS} (
    crop_code string NOT NULL,
    metric string NOT NULL,
    target_min double,
    target_max double,
    alert_below double,
    alert_above double
) USING iceberg
TBLPROPERTIES ('format-version' = '2')
"""


def crop_target_rows(
    reference: ReferenceData,
) -> list[tuple[str, str, float | None, float | None, float | None, float | None]]:
    """One row per (crop, metric) target range, the contract of ``ops.crop_targets``."""
    return [
        (crop.crop_code, metric, target.min, target.max, target.alert_below, target.alert_above)
        for crop in reference.crops.values()
        for metric, target in sorted(crop.targets.items())
    ]


def load_crop_targets(spark, reference: ReferenceData) -> int:
    """Replace ``ops.crop_targets`` with the reference data so dbt gold models can join the targets.

    The JSON file stays the single source of truth: edit it, rerun ``just lakehouse-init`` and the
    next ``just dbt-run`` recomputes the indicators with the new ranges.
    """
    spark.sql(CROP_TARGETS_DDL)
    rows = crop_target_rows(reference)
    columns = (
        "crop_code string, metric string, target_min double, target_max double, "
        "alert_below double, alert_above double"
    )
    spark.createDataFrame(rows, schema=columns).createOrReplaceTempView("src_crop_targets")
    spark.sql(f"INSERT OVERWRITE {CROP_TARGETS} SELECT * FROM src_crop_targets")
    return len(rows)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s %(name)s - %(message)s")
    parser = argparse.ArgumentParser(description="Create/drop the Iceberg medallion namespaces")
    parser.add_argument("--drop-all", action="store_true", help="drop all namespaces and their tables first")
    args = parser.parse_args()

    spark = build_spark()
    try:
        if args.drop_all:
            for namespace in reversed(NAMESPACES):
                spark.sql(f"DROP NAMESPACE IF EXISTS {CATALOG}.{namespace} CASCADE")
                log.warning("dropped %s.%s", CATALOG, namespace)
        for namespace in NAMESPACES:
            spark.sql(f"CREATE NAMESPACE IF NOT EXISTS {CATALOG}.{namespace}")
        log.info("initialized Iceberg namespaces: %s", ", ".join(NAMESPACES))
        log.info(
            "loaded %d crop target ranges into %s", load_crop_targets(spark, load_reference()), CROP_TARGETS
        )
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
