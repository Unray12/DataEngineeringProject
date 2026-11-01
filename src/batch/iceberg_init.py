"""Create the medallion namespaces in the Iceberg/Hive catalog.

``just lakehouse-init`` runs this before the streaming job starts so that
``bronze`` and ``ops`` exist (the streaming job also creates them, idempotently)
and so the dbt-built ``silver``/``gold`` namespaces are ready.

    python -m batch.iceberg_init            # create namespaces
    python -m batch.iceberg_init --drop-all # drop every lakehouse table first
"""

from __future__ import annotations

import argparse
import logging

from streaming.spark import build_spark

log = logging.getLogger("batch.iceberg_init")

NAMESPACES = ("bronze", "silver", "gold", "ops")
CATALOG = "lakehouse"


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
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
