# Shared image for the Python services that are not Spark jobs: the FastAPI
# access layer, the HTTP ingest service and the sensor simulator. They need the
# same runtime (Python 3.11 + the project's client libraries) but no Spark, so
# the Spark/pyarrow bulk is filtered out of the dependency export.
FROM python:3.11-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.12.22 /uv /uvx /bin/

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PYTHONPATH=/app/src

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv export --locked --no-dev --no-emit-project --no-hashes --format requirements-txt \
      --output-file /tmp/requirements.txt \
    && grep -viE '^(pyspark|py4j)==' /tmp/requirements.txt > /tmp/requirements-service.txt \
    && uv pip install --system --no-cache -r /tmp/requirements-service.txt \
    && rm /tmp/requirements*.txt

# Shared code. `reference/` is master data, mounted read-only at runtime too.
COPY src /app/src
COPY reference /app/reference

ENV REFERENCE_DATA_PATH=/app/reference/reference_data.json

CMD ["python", "-m", "api"]
