"""Responsive and console QA for the dashboard, measured rather than eyeballed.

Visits every registered page at four viewport widths, compares
``document.documentElement.scrollWidth`` with ``clientWidth``, names any element
that overflows outside its own scroll container, and collects console errors.

Chrome's window resizing does not change the rendered viewport reliably on this
machine, which is why this uses Playwright and measures the DOM.

Usage:
    python scripts/responsive_qa.py --base http://127.0.0.1:8501
"""

from __future__ import annotations

import argparse
import json
import sys

PAGES = [
    ("Overview", ""),
    ("Drug Screening", "screening"),
    ("Candidate Explorer", "candidates"),
    ("Drug Details", "drug"),
    ("Case Study", "case-study"),
    ("Medicine x Disease", "explorer"),
    ("Molecular Analysis", "molecular"),
    ("Docking & 3D", "docking"),
    ("Clinical Evidence", "clinical"),
    ("Model & Dataset", "model"),
    ("Pipeline", "pipeline"),
    ("Retraining", "retraining"),
    ("Run History", "runs"),
]

WIDTHS = [1440, 1024, 760, 400]

# Streamlit's own table grid scrolls inside its container by design; it is the
# one element allowed to be wider than the viewport.
ALLOWED_OVERFLOW = ("dvn-stack", "glideDataEditor", "stDataFrame")

MEASURE = """
() => {
  const de = document.documentElement;
  const offenders = [];
  const scrollableAncestor = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return p;
    }
    return null;
  };
  document.querySelectorAll('body *').forEach(el => {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' && cs.overflowX !== 'clip') return;
      // Content wider than its box is only a defect when nothing between it and
      // the document can scroll it into view. Streamlit's table grid and the
      // chart frames scroll inside their own containers by design.
      if (scrollableAncestor(el)) return;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString ? el.className.toString() : '').slice(0, 80),
        testid: el.getAttribute('data-testid') || '',
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
  });
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    textLength: document.body.innerText.length,
    h1: (document.querySelector('h1') || {}).innerText || '',
    offenders: offenders.slice(0, 12),
  };
}
"""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8501")
    parser.add_argument("--out", default="")
    parser.add_argument("--settle-ms", type=int, default=4000)
    args = parser.parse_args(argv)

    from playwright.sync_api import sync_playwright

    results: list[dict] = []
    console: list[dict] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for width in WIDTHS:
            context = browser.new_context(viewport={"width": width, "height": 900})
            page = context.new_page()
            page.on("console", lambda msg, w=width: console.append(
                {"width": w, "type": msg.type, "text": msg.text[:300]}
            ) if msg.type in ("error", "warning") else None)
            page.on("pageerror", lambda exc, w=width: console.append(
                {"width": w, "type": "pageerror", "text": str(exc)[:300]}
            ))
            for name, path in PAGES:
                url = args.base.rstrip("/") + "/" + path
                page.goto(url, wait_until="load")
                try:
                    page.wait_for_selector("h1", timeout=20000)
                except Exception:
                    pass
                page.wait_for_timeout(args.settle_ms)
                measured = page.evaluate(MEASURE)
                real = [
                    o for o in measured["offenders"]
                    if not any(a in (o["cls"] + o["testid"]) for a in ALLOWED_OVERFLOW)
                ]
                results.append({
                    "page": name,
                    "path": path or "/",
                    "width": width,
                    "scrollWidth": measured["scrollWidth"],
                    "clientWidth": measured["clientWidth"],
                    "overflow": measured["scrollWidth"] - measured["clientWidth"],
                    "textLength": measured["textLength"],
                    "h1": measured["h1"][:70],
                    "offenders": real,
                })
                flag = "OVERFLOW" if measured["scrollWidth"] > measured["clientWidth"] else "ok"
                print(f"{width:>5}px  {name:<22} scrollW={measured['scrollWidth']:<6} "
                      f"clientW={measured['clientWidth']:<6} text={measured['textLength']:<6} "
                      f"{flag} offenders={len(real)}", flush=True)
            context.close()
        browser.close()

    page_overflow = [r for r in results if r["overflow"] > 0]
    element_overflow = [r for r in results if r["offenders"]]
    empty_pages = [r for r in results if r["textLength"] < 400]
    errors = [c for c in console if c["type"] in ("error", "pageerror")]

    print()
    print(f"pages checked      : {len(results)} ({len(PAGES)} pages x {len(WIDTHS)} widths)")
    print(f"page overflow      : {len(page_overflow)}")
    print(f"element overflow   : {len(element_overflow)}")
    print(f"suspiciously empty : {len(empty_pages)}")
    print(f"console errors     : {len(errors)}")
    for r in page_overflow:
        print(f"  ! {r['width']}px {r['page']}: {r['scrollWidth']} > {r['clientWidth']}")
    for r in element_overflow:
        for o in r["offenders"]:
            print(f"  ! {r['width']}px {r['page']}: <{o['tag']} class={o['cls']}> "
                  f"{o['scrollWidth']} > {o['clientWidth']}")
    for e in errors[:20]:
        print(f"  ! console {e['width']}px {e['type']}: {e['text']}")

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"results": results, "console": console}, fh, indent=2)
        print(f"\nwrote {args.out}")

    return 0 if not (page_overflow or element_overflow or errors) else 1


if __name__ == "__main__":
    sys.exit(main())
