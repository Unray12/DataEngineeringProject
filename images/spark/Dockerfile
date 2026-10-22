# Spark job runner: streaming micro-batch jobs, batch jobs and dbt-spark.
#
# Base image is python:3.11-slim (arm64 native on Apple Silicon) rather than
# apache/spark, because the official Spark image ships Python 3.8 and only an
# amd64 build, which would run the JVM under x86 emulation. PySpark is
# installed with uv, so the whole distribution (jars, spark-submit) lands in
# site-packages.
FROM python:3.11-slim-bookworm

# uv manages every Python dependency in this image.
COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /uvx /bin/

ARG SPARK_VERSION=3.5.3
ARG ICEBERG_VERSION=1.7.1
# The Iceberg runtime jar is published per Spark minor version (3.5), not 3.5.3.
ARG ICEBERG_SPARK_VERSION=3.5
ARG SCALA_VERSION=2.12

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/usr/local \
    SPARK_HOME=/usr/local/lib/python3.11/site-packages/pyspark \
    SPARK_LOCAL_DIRS=/tmp/spark \
    HADOOP_HOME=/opt/hadoop \
    HADOOP_CONF_DIR=/opt/hadoop/conf \
    ICEBERG_VERSION=${ICEBERG_VERSION} \
    PATH=/usr/local/lib/python3.11/site-packages/pyspark/bin:/usr/local/lib/python3.11/site-packages/pyspark/sbin:${PATH}

# openjdk-17 is the newest JRE in Debian bookworm; Spark 3.5 supports Java 17.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openjdk-17-jre-headless \
        curl \
        procps \
    && rm -rf /var/lib/apt/lists/*

# Project metadata lives in pyproject.toml (hatchling backend). `uv sync`
# installs the runtime + dev dependency groups into the system environment so
# spark-submit and the Trino/Cassandra clients are all on PATH.
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv export --locked --no-dev --no-emit-project --format requirements-txt \
      --output-file /tmp/requirements.txt \
    && uv pip install --system --no-cache -r /tmp/requirements.txt \
    && uv pip install --system --no-cache "pyspark==${SPARK_VERSION}" \
    && rm /tmp/requirements.txt

# Iceberg runtime jar. The shaded artifact is the supported way to add Iceberg to
# a Spark distribution: it carries the Spark actions used for merge-on-read and
# for row-level deletes in the streaming jobs.
RUN curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 \
      -o "${SPARK_HOME}/jars/iceberg-spark-runtime-${ICEBERG_SPARK_VERSION}_${SCALA_VERSION}-${ICEBERG_VERSION}.jar" \
      "https://repo.maven.apache.org/maven2/org/apache/iceberg/iceberg-spark-runtime-${ICEBERG_SPARK_VERSION}_${SCALA_VERSION}/${ICEBERG_VERSION}/iceberg-spark-runtime-${ICEBERG_SPARK_VERSION}_${SCALA_VERSION}-${ICEBERG_VERSION}.jar" \
    && chmod 0644 "${SPARK_HOME}/jars/iceberg-spark-runtime-${ICEBERG_SPARK_VERSION}_${SCALA_VERSION}-${ICEBERG_VERSION}.jar"

# Kafka connector for Spark Structured Streaming (readStream.format("kafka")).
# PySpark does not bundle it, so the structured-streaming Kafka connector, its
# token provider, the matching kafka-clients and the commons-pool2 it needs are
# fetched into SPARK_HOME/jars. Versions must match the Spark 3.5.3 release.
ARG KAFKA_CLIENTS_VERSION=3.4.1
RUN cd "${SPARK_HOME}/jars" \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -O \
      "https://repo.maven.apache.org/maven2/org/apache/spark/spark-sql-kafka-0-10_${SCALA_VERSION}/${SPARK_VERSION}/spark-sql-kafka-0-10_${SCALA_VERSION}-${SPARK_VERSION}.jar" \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -O \
      "https://repo.maven.apache.org/maven2/org/apache/spark/spark-token-provider-kafka-0-10_${SCALA_VERSION}/${SPARK_VERSION}/spark-token-provider-kafka-0-10_${SCALA_VERSION}-${SPARK_VERSION}.jar" \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -O \
      "https://repo.maven.apache.org/maven2/org/apache/kafka/kafka-clients/${KAFKA_CLIENTS_VERSION}/kafka-clients-${KAFKA_CLIENTS_VERSION}.jar" \
    && curl -fsSL --retry 5 --retry-all-errors --retry-delay 3 -O \
      "https://repo.maven.apache.org/maven2/org/apache/commons/commons-pool2/2.12.0/commons-pool2-2.12.0.jar" \
    && chmod 0644 *.jar

CMD ["spark-submit", "--help"]