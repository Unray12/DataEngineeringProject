"""Run the ingest service with uvicorn: ``python -m ingest``."""

from __future__ import annotations

import os

import uvicorn


def main() -> None:
    port = int(os.environ.get("INGEST_PORT", "8081"))
    uvicorn.run("ingest.app:app", host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
