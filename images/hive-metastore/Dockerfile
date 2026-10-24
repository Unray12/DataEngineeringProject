# Hive Metastore: the Iceberg catalog for Spark and Trino.
#
# Built from the official apache/hive image with the Iceberg jars added, so the
# metastore can serve Iceberg table metadata to every client of the platform.
#
# The jars are fetched in a separate native build stage: the Hive image ships no
# curl or wget, and `ADD <url>` is not retried by BuildKit.
FROM --platform=$BUILDPLATFORM curlimages/curl:8.20.0 AS jars

ARG ICEBERG_VERSION=1.7.1

# curlimages/curl defaults to a non-root user. The downloaded jars are copied
# into the Hive image, so create the staging directory with build privileges.
USER root

RUN mkdir -p /jars && cd /jars && \
    for artifact in api common bundled-guava core hive-metastore; do \
      echo "fetching iceberg-${artifact}-${ICEBERG_VERSION}.jar"; \
      curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
        -o "iceberg-${artifact}-${ICEBERG_VERSION}.jar" \
        "https://repo.maven.apache.org/maven2/org/apache/iceberg/iceberg-${artifact}/${ICEBERG_VERSION}/iceberg-${artifact}-${ICEBERG_VERSION}.jar" || exit 1; \
    done

FROM apache/hive:3.1.3

ARG ICEBERG_VERSION=1.7.1

USER root

# api/common/bundled-guava are the runtime dependencies of iceberg-core;
# iceberg-hive-metastore carries the HMS integration (IcebergHiveHook and the
# HiveCatalog client). bundled-guava is shaded, so it cannot clash with the
# Guava that Hive itself ships.
COPY --from=jars /jars/ /opt/hive/lib/

RUN chown -R hive:hive /opt/hive/lib

# Idempotent schema bootstrap: create the Derby metastore schema on the first
# start, reuse it afterwards. Replaces the upstream entrypoint, which either
# re-initialises on every start or skips initialisation entirely.
COPY entrypoint.sh /opt/dep/hive-metastore-entrypoint.sh
RUN chmod +x /opt/dep/hive-metastore-entrypoint.sh

USER hive

ENTRYPOINT ["/opt/dep/hive-metastore-entrypoint.sh"]