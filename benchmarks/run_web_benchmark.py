"""Benchmark #6: responsiveness of the API and the web app.

* Every FastAPI endpoint the web app uses, called directly (``--runs`` times after a warm-up):
  p50/p95/max latency and response size, grouped by the store behind it (Cassandra or Trino).
* Every page of the Next.js app as a browser loads it: the HTML document, then all the ``/api/*``
  calls the page makes on load, fired in parallel (the lists were read from the browser's resource
  timing on each page). "Data ready" is the HTML time plus the slowest of those calls; rendering in
  the browser is not included.

Run from the host against the published ports: ``just bench-web``.
"""

from __future__ import annotations

import argparse
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta

import httpx

import host
from common import summarize, write_results

FROM, TO = "2026-11-04", "2026-11-10"  # the last 7 days with gold data
WEEK = f"from={FROM}&to={TO}"

# (path, store behind it, page that calls it)
ENDPOINTS = [
    ("/health/ready", "-", "-"),
    ("/farms", "reference data", "Overview"),
    ("/farms/FM001/fields", "reference data + Cassandra", "Overview"),
    ("/devices", "Cassandra", "Devices"),
    ("/devices/F001-S01/status", "Cassandra", "Devices"),
    ("/fields/F001/latest", "Cassandra", "Live, Field"),
    ("/fields/F001/series?metric=soil_moisture&hours=24", "Cassandra", "Live"),
    ("/fields/F001/alerts", "Cassandra", "Field"),
    ("/alerts?status=open", "Cassandra", "Alerts"),
    (f"/fields/F001/indicators?{WEEK}&granularity=daily&metric=soil_moisture", "Trino (gold)", "Analytics"),
    (f"/fields/F001/indicators?{WEEK}&granularity=hourly&metric=soil_moisture", "Trino (gold)", "Analytics"),
    (f"/fields/F001/history?{WEEK}&granularity=daily&metric=soil_moisture", "Trino (gold)", "Analytics"),
    (f"/fields/F001/history?{WEEK}&granularity=hourly&metric=soil_moisture", "Trino (gold)", "Analytics"),
    (f"/summary?{WEEK}", "Trino (gold)", "Insights"),
    (f"/compare?field_ids=F001,F002,F003,F004&metric=soil_moisture&{WEEK}", "Trino (gold)", "Insights"),
    (f"/quality/summary?{WEEK}", "Trino (gold)", "Data quality"),
    ("/quality/devices", "Trino (ops)", "Data quality"),
]


def page_calls(today: date) -> dict[str, list[str]]:
    """The /api/* calls each page makes on load, with the date windows the pages compute from today."""
    day = timedelta(days=1)
    week = f"from={today - 6 * day}&to={today}"
    previous = f"from={today - 13 * day}&to={today - 7 * day}"
    fields = "F001%2CF002%2CF003%2CF008%2CF004%2CF005%2CF006%2CF007"
    farms = [f"/api/farms/FM00{n}/fields" for n in range(1, 5)]
    metrics = ["soil_moisture", "soil_temperature", "air_temperature", "air_humidity", "rainfall"]
    return {
        "/": ["/api/overview"],
        "/live": ["/api/alerts", "/api/farms", *farms],
        "/devices": ["/api/devices", "/api/farms", *farms],
        "/alerts": ["/api/alerts", "/api/alerts/reference"],
        "/quality": [f"/api/quality/summary?from={today - 29 * day}&to={today}", "/api/quality/devices"],
        "/insights": [
            "/api/overview",
            f"/api/summary?{week}",
            f"/api/summary?{previous}",
            f"/api/compare?fieldIds={fields}&metric=soil_moisture&{week}",
        ],
        "/analytics": [
            "/api/analytics/fields",
            f"/api/analytics?fieldId=F001&metric=soil_moisture&granularity=daily&from={today - 7 * day}&to={today}",
        ],
        "/fields/F001": [
            "/api/overview",
            *[f"/api/compare?fieldIds={fields}&metric={m}&{w}" for m in metrics for w in (week, previous)],
        ],
    }


def timed(client: httpx.Client, url: str, runs: int, warmup: int) -> tuple[dict[str, float], int, float]:
    for _ in range(warmup):
        client.get(url).raise_for_status()
    samples, size = [], 0
    for _ in range(runs):
        started = time.perf_counter()
        response = client.get(url)
        samples.append((time.perf_counter() - started) * 1000)
        response.raise_for_status()
        size = len(response.content)
    return summarize(samples), size, round(max(samples), 1)


def load_page(client: httpx.Client, pool: ThreadPoolExecutor, web: str, page: str, calls: list[str]):
    """(HTML ms, data-ready ms) of one page load: the document, then its API calls in parallel."""
    started = time.perf_counter()
    client.get(web + page).raise_for_status()
    html = (time.perf_counter() - started) * 1000
    for response in pool.map(lambda call: httpx.get(web + call, timeout=60), calls):
        response.raise_for_status()
    return html, (time.perf_counter() - started) * 1000


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    args = parser.parse_args()
    host.detect_hardware()
    api = f"http://localhost:{os.environ.get('API_PORT', '8000')}"
    web = f"http://localhost:{os.environ.get('WEB_PORT', '3000')}"
    config = {
        "benchmark": "#6 API and web responsiveness",
        "client": "httpx from the host, one client, sequential requests, keep-alive",
        "runs": args.runs,
        "warmup": args.warmup,
        "date_range": f"{FROM}..{TO} (7 days of gold data)",
        "stream": "running (30 s trigger) with the simulator, as in normal use",
        "web_server": os.environ.get(
            "BENCH_WEB_MODE", "next start (production build, images/web/Dockerfile)"
        ),
    }

    rows, page_rows = [], []
    with httpx.Client(timeout=60) as client:
        for path, store, page in ENDPOINTS:
            stats, size, worst = timed(client, api + path, args.runs, args.warmup)
            rows.append(["api", path, store, page, args.runs, size, stats["p50"], stats["p95"], worst])
            print(f"{path:<90} {stats['p50']:>8} {stats['p95']:>8}")
        pages = page_calls(datetime.now(UTC).date())
        with ThreadPoolExecutor(max_workers=16) as pool:
            for page, calls in pages.items():
                for _ in range(args.warmup):
                    load_page(client, pool, web, page, calls)
                html, ready = zip(
                    *(load_page(client, pool, web, page, calls) for _ in range(args.runs)), strict=True
                )
                h, r = summarize(list(html)), summarize(list(ready))
                page_rows.append([page, len(calls), args.runs, h["p50"], h["p95"], r["p50"], r["p95"]])
                print(
                    f"{page:<40} html {h['p50']:>7}  ready {r['p50']:>7} {r['p95']:>7}  ({len(calls)} calls)"
                )
    write_results(
        "web.csv",
        config,
        ["path", "store", "used_by", "runs", "bytes", "p50_ms", "p95_ms", "max_ms"],
        [row[1:] for row in rows],
    )
    write_results(
        "web_pages.csv",
        {
            **config,
            "page_load": "HTML document, then the page's /api/* calls in parallel; browser rendering excluded",
        },
        ["page", "api_calls", "runs", "html_ms_p50", "html_ms_p95", "data_ready_ms_p50", "data_ready_ms_p95"],
        page_rows,
    )


if __name__ == "__main__":
    main()
