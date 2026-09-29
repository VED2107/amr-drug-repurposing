"""Stage - existing use and anti-infective classification of approved medicines.

For every medicine in the approved library this records what it is already
classified and approved for, and applies the documented rule in
``src/ingestion/classification.py`` to decide whether it is already an
antibacterial. The website uses that status to keep existing antibacterials out
of the repurposing candidates; the full library is never filtered.

Nothing here touches the models or the predictions, so running it never calls
for retraining.

Usage:
    python -m src.pipeline.classify
"""

from __future__ import annotations

import argparse
import sqlite3
from collections import defaultdict

from ..config import Config, load_config
from ..db import init_db, record_source, session, utcnow
from ..ingestion.classification import (
    EXPLICIT_ATC,
    RULE_VERSION,
    ClassificationClient,
    classify,
    is_antibacterial,
    strip_epc_suffix,
)
from ..ingestion.http import NetworkDisabledError
from ..logging_utils import get_logger, setup_logging
from .runlog import STATUS_SKIPPED, PipelineRun, stage_run

log = get_logger("amr.pipeline.classify")

#: FDA applications read per medicine. Every single-ingredient label of one
#: molecule carries the same pharmacologic class, so a few are enough; brand
#: (NDA) applications come first because they hold the originator's label.
MAX_APPLICATIONS_PER_MEDICINE = 25
FIRST_ROUND_APPLICATIONS = 4


def library(conn: sqlite3.Connection) -> dict[str, dict[str, list[str]]]:
    """Per medicine: its ChEMBL ids and the FDA applications to read."""
    out: dict[str, dict[str, list[str]]] = defaultdict(lambda: {"chembl": [], "apps": [], "names": []})
    rows = conn.execute(
        """SELECT molecule_id, chembl_id, application_type, application_no, match_method, generic_name
             FROM drugs WHERE molecule_id IS NOT NULL
            ORDER BY molecule_id,
                     CASE application_type WHEN 'N' THEN 0 ELSE 1 END,
                     application_no"""
    ).fetchall()
    for r in rows:
        entry = out[r["molecule_id"]]
        if r["chembl_id"] and r["chembl_id"] not in entry["chembl"]:
            entry["chembl"].append(r["chembl_id"])
        # A combination product is linked to one of its components; its label
        # describes the combination, so it is not read for that component.
        if (r["match_method"] or "").startswith("combination"):
            continue
        if r["generic_name"] and r["generic_name"] not in entry["names"]:
            entry["names"].append(r["generic_name"])
        prefix = "NDA" if r["application_type"] == "N" else "ANDA"
        app = f"{prefix}{r['application_no']}"
        if r["application_no"] and app not in entry["apps"] and len(entry["apps"]) < MAX_APPLICATIONS_PER_MEDICINE:
            entry["apps"].append(app)
    return dict(out)


def classify_library(conn: sqlite3.Connection, cfg: Config, run: PipelineRun) -> dict[str, int]:
    client = ClassificationClient(cfg, label_cache=cfg.path_for("data_raw") / "openfda_label_classes.json")
    lib = library(conn)
    run.processed = len(lib)

    chembl_ids = sorted({c for m in lib.values() for c in m["chembl"]})
    log.info("reading ATC codes for %d ChEMBL molecules", len(chembl_ids))
    mols = client.molecules(chembl_ids)
    parents = sorted({m["parent"] for m in mols.values() if m["parent"]} - set(mols))
    if parents:
        mols.update(client.molecules(parents))
    # A prodrug's ATC code is filed under the drug it releases, which ChEMBL
    # records as the active moiety (cefuroxime axetil → cefuroxime).
    actives = sorted({m.get("active") for m in mols.values() if m.get("active")} - set(mols))
    if actives:
        mols.update(client.molecules(actives))
    roots = sorted({m["parent"] or cid for cid, m in mols.items()})
    log.info("reading salt and hydrate forms of %d parent molecules", len(roots))
    children = client.child_forms(roots)
    by_parent: dict[str, list[str]] = defaultdict(list)
    for cid, m in children.items():
        mols.setdefault(cid, m)
        if m["parent"] and m["parent"] != cid:
            by_parent[m["parent"]].append(cid)
    atc_names = client.atc_names()

    all_ids = sorted(set(chembl_ids) | {m["parent"] for m in mols.values() if m["parent"]})
    log.info("reading approved indications for %d ChEMBL molecules", len(all_ids))
    indications = client.approved_indications(all_ids)

    # Two rounds: the first few applications of every medicine, then more only
    # for medicines that still have no single-ingredient label. Every such
    # label of one molecule carries the same class, so one is enough.
    apps = sorted({a for m in lib.values() for a in m["apps"][:FIRST_ROUND_APPLICATIONS]})
    log.info("reading FDA labels for %d applications", len(apps))
    labels = client.fda_labels(apps)
    unread = list(client.unread_applications)
    missing = [
        m for m in lib.values()
        if not any((labels.get(a) or {}).get("single") for a in m["apps"])
    ]
    more = sorted({a for m in missing for a in m["apps"][FIRST_ROUND_APPLICATIONS:]})
    if more:
        log.info("reading %d more applications for %d medicines without a label", len(more), len(missing))
        labels = client.fda_labels(sorted(set(apps) | set(more)))
        unread += client.unread_applications
    for app in sorted(set(unread)):
        run.record_error(f"openfda:{app}", "label could not be read; classified from other sources")

    by_chembl: dict[str, list[dict]] = defaultdict(list)
    for ind in indications:
        if ind["chembl_id"] and ind["indication"]:
            by_chembl[ind["chembl_id"]].append(ind)

    now = utcnow()
    counts: dict[str, int] = defaultdict(int)
    conn.execute("DELETE FROM medicine_classes")
    conn.execute("DELETE FROM medicine_indications")
    conn.execute("DELETE FROM medicine_use_status")

    def ids_for(entry: dict[str, list[str]]) -> list[str]:
        ids = list(entry["chembl"])
        for cid in entry["chembl"]:
            parent = (mols.get(cid) or {}).get("parent")
            if parent and parent not in ids:
                ids.append(parent)
        for cid in list(ids):
            active = (mols.get(cid) or {}).get("active")
            if active and active not in ids:
                ids.append(active)
        for root in list(ids):
            for child in by_parent.get(root, []):
                if child not in ids:
                    ids.append(child)
        return ids

    def atc_for(ids: list[str]) -> dict[str, str]:
        atc: dict[str, str] = {}
        for cid in ids:
            for code in (mols.get(cid) or {}).get("atc") or []:
                atc.setdefault(code, cid)
        if not atc:
            # Only where ChEMBL records no ATC code at all.
            for cid in ids:
                if cid in EXPLICIT_ATC:
                    atc.setdefault(EXPLICIT_ATC[cid][0], f"explicit:{cid}")
        return atc

    def has_label(entry: dict[str, list[str]]) -> bool:
        return any((labels.get(a) or {}).get("single") and (labels.get(a) or {}).get("classes")
                   for a in entry["apps"])

    # Last source, only for medicines with no ATC code and no class from their
    # own applications' labels: single-ingredient FDA labels found by the exact
    # active substance (openFDA substance_name, the FDA's UNII name). This is an
    # identity lookup, not a guess from how a name sounds.
    wanted = {
        mid: entry["names"] for mid, entry in lib.items()
        if not atc_for(ids_for(entry)) and not has_label(entry) and entry["names"]
    }
    by_substance = client.fda_classes_by_substance(sorted({n for ns in wanted.values() for n in ns}))
    log.info("FDA classes found by substance for %d of %d medicines without ATC or label class",
             sum(1 for ns in wanted.values() if any(by_substance.get(n.upper()) for n in ns)), len(wanted))

    for molecule_id, entry in sorted(lib.items()):
        ids = ids_for(entry)
        atc = atc_for(ids)
        for code, cid in sorted(atc.items()):
            names = atc_names.get(code, {})
            conn.execute(
                """INSERT INTO medicine_classes(molecule_id, system, code, name, group_name,
                       therapeutic_group, source_ref, retrieved_at)
                   VALUES(?, 'WHO ATC', ?, ?, ?, ?, ?, ?)""",
                (molecule_id, code, names.get("name") or None, names.get("level4") or None,
                 names.get("level2") or None, cid, now),
            )

        epc: dict[str, str] = {}
        set_id = None
        for app in entry["apps"]:
            label = labels.get(app)
            if not label or not label["single"]:
                continue
            set_id = set_id or label["set_id"]
            for c in sorted(label["classes"]):
                epc.setdefault(strip_epc_suffix(c), app)
        if not atc and not epc:
            for name in wanted.get(molecule_id, []):
                found = by_substance.get(name.upper())
                if found:
                    set_id = set_id or found["set_id"]
                    for c in sorted(found["classes"]):
                        epc.setdefault(strip_epc_suffix(c), f"substance:{name.upper()}")
        for c, app in sorted(epc.items()):
            conn.execute(
                """INSERT INTO medicine_classes(molecule_id, system, code, name, group_name,
                       therapeutic_group, source_ref, retrieved_at)
                   VALUES(?, 'FDA EPC', ?, ?, NULL, NULL, ?, ?)""",
                (molecule_id, c, c, app, now),
            )

        seen: set[str] = set()
        for cid in ids:
            for ind in by_chembl.get(cid, []):
                key = ind["indication"].strip().lower()
                if key in seen:
                    continue
                seen.add(key)
                conn.execute(
                    """INSERT INTO medicine_indications(molecule_id, indication, mesh_heading,
                           source_ref, ref_url, retrieved_at) VALUES(?,?,?,?,?,?)""",
                    (molecule_id, ind["indication"].strip(), ind["mesh_heading"], cid,
                     ind["ref_url"], now),
                )

        result = classify(atc.keys(), epc.keys())
        counts[result.status] += 1
        conn.execute(
            """INSERT INTO medicine_use_status(molecule_id, status, is_antibacterial, basis,
                   rule_version, fda_label_set_id, retrieved_at) VALUES(?,?,?,?,?,?,?)""",
            (molecule_id, result.status, is_antibacterial(result.status),
             "; ".join(result.basis) or None, RULE_VERSION, set_id, now),
        )
    conn.commit()
    record_source(conn, "chembl_atc_indications", client.base, len(indications), notes=RULE_VERSION)
    record_source(conn, "openfda_label_classes", client.OPENFDA_LABEL_URL, len(labels), notes=RULE_VERSION)
    run.new = len(lib)
    return dict(counts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    with session(cfg) as conn:
        init_db(conn, cfg)
        with stage_run(conn, "classify") as run:
            try:
                counts = classify_library(conn, cfg, run)
            except NetworkDisabledError as exc:
                run.status = STATUS_SKIPPED
                run.message = str(exc)
                log.warning("classification skipped: %s", exc)
                return 0
            run.note("status_counts", counts)
            for status, n in sorted(counts.items()):
                log.info("%-22s %5d", status, n)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
