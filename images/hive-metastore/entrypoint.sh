#!/usr/bin/env bash
#
# Idempotent entrypoint for the Hive Metastore.
#
# The upstream apache/hive entrypoint runs `schematool -initSchema` on every
# start unless IS_RESUME=true, and skips it entirely when IS_RESUME=true. Neither
# is right for a named volume: the first start must create the schema, later
# starts must reuse it.
#
# This script:
#   1. exports the JDO connection URL (Derby lives on the named volume),
#   2. asks schematool for the schema version (`-info`),
#   3. initialises the schema when it is missing,
#   4. recovers from a *partial* schema (an init that was interrupted, e.g. the
#      host or container died mid-way). That leaves Derby objects behind without
#      a VERSION row, so `-info` fails and `-initSchema` then fails with
#      "already exists". The partial DB is moved aside and rebuilt.
#
# The metastore catalog only holds table metadata; the data lives in HDFS. A
# rebuilt catalog is repopulated by `just lakehouse-init`, so recovering is
# safe and keeps BR3 (continuity) working across restarts.
set -euo pipefail

: "${DB_DRIVER:=derby}"
: "${SERVICE_NAME:=metastore}"
: "${DERBY_DATA_DIR:=/opt/hive/data}"
: "${DERBY_DB_NAME:=metastore_db}"

export HIVE_CONF_DIR="${HIVE_HOME}/conf"
export HADOOP_CLIENT_OPTS="${HADOOP_CLIENT_OPTS:-} -Xmx1G ${SERVICE_OPTS:-}"

db_dir="${DERBY_DATA_DIR}/${DERBY_DB_NAME}"

# `schematool -info` exports the connection URL from HADOOP_CLIENT_OPTS, so the
# JDO settings in SERVICE_OPTS are what point it at the volume-backed Derby DB.
if "${HIVE_HOME}/bin/schematool" -dbType "${DB_DRIVER}" -info >/dev/null 2>&1; then
    echo "[hive-metastore] schema already present, skipping init"
else
    if [ -d "${db_dir}" ]; then
        # A Derby DB directory exists but the schema is unreadable: it is a
        # leftover from an interrupted init, or a newer/older schema. Move it
        # aside so `-initSchema` starts from a clean database.
        backup="${db_dir}.partial.$(date -u +%Y%m%dT%H%M%SZ)"
        echo "[hive-metastore] schema unreadable but ${db_dir} exists; moving it to ${backup}"
        mv "${db_dir}" "${backup}"
    fi
    echo "[hive-metastore] initialising ${DB_DRIVER} schema"
    "${HIVE_HOME}/bin/schematool" -dbType "${DB_DRIVER}" -initSchema
fi

exec "${HIVE_HOME}/bin/hive" --skiphadoopversion --skiphbasecp --service "${SERVICE_NAME}"
