"""Measure how long each dashboard page takes to become readable.

Loads every page in a real browser and records the time from navigation until
the page's first heading is present and its text has stopped growing. That is a
closer measure of "the reader can use this" than a network timing, because
Streamlit streams its content in over a websocket after the HTML arrives.

Usage:
    python scripts/performance_qa.py --base http://127.0.0.1:8501 --repeats 2
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time

from scripts.responsive_qa import PAGES


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8501")
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--settle-ms", type=int, default=400)
    parser.add_argument("--timeout-ms", type=int, default=45000)
    parser.add_argument("--out", default="")
    args = parser.parse_args(argv)

    from playwright.sync_api import sync_playwright

    timings: dict[str, list[float]] = {name: [] for name, _ in PAGES}

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        for run in range(args.repeats):
            for name, path in PAGES:
                url = args.base.rstrip("/") + "/" + path
                started = time.perf_counter()
                page.goto(url, wait_until="load")
                try:
                    page.wait_for_selector("h1", timeout=args.timeout_ms)
                except Exception:
                    print(f"  ! {name}: no heading within {args.timeout_ms} ms")
                    timings[name].append(float("nan"))
                    continue

                # Wait until the rendered text stops growing: Streamlit fills the
                # page in stages, and the first heading is not the end of it.
                previous, stable_since = -1, time.perf_counter()
                while True:
                    length = page.evaluate("() => document.body.innerText.length")
                    now = time.perf_counter()
                    if length != previous:
                        previous, stable_since = length, now
                    elif (now - stable_since) * 1000 >= args.settle_ms:
                        break
                    if (now - started) * 1000 > args.timeout_ms:
                        break
                    page.wait_for_timeout(100)

                elapsed = (time.perf_counter() - started) * 1000 - args.settle_ms
                timings[name].append(elapsed)
                if run == args.repeats - 1:
                    print(f"{name:<24} {statistics.median(timings[name]):8.0f} ms  "
                          f"(runs: {', '.join(f'{t:.0f}' for t in timings[name])})")

        browser.close()

    medians = {name: statistics.median(values) for name, values in timings.items() if values}
    print()
    print(f"slowest: {max(medians, key=medians.get)} at {max(medians.values()):.0f} ms")
    print(f"fastest: {min(medians, key=medians.get)} at {min(medians.values()):.0f} ms")
    print(f"median across pages: {statistics.median(medians.values()):.0f} ms")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"timings_ms": timings, "medians_ms": medians}, fh, indent=2)
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
