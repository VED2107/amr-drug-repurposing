"""Stage 5 - molecular docking of top candidates with AutoDock Vina.

Docking is expensive, so only the top-ranked candidates per target are docked,
and results are cached: a compound already docked against a target with the same
parameters is not redocked.

If Vina is unavailable, or a receptor cannot be prepared, the limitation is
recorded against the target and the pipeline continues.

Usage:
    python -m src.pipeline.dock
    python -m src.pipeline.dock --target sa_dhfr --limit 5
"""

from __future__ import annotations

import argparse
import sqlite3
import uuid
from pathlib import Path

from ..config import PROJECT_ROOT, Config, load_config
from ..db import init_db, session, utcnow
from ..docking import (
    LigandPreparationError,
    ReceptorPreparationError,
    TargetSpec,
    VinaError,
    dock_ligand,
    load_targets,
    prepare_ligand,
    prepare_receptor,
    vina_version,
)
from ..ingestion.http import HttpClient
from ..logging_utils import get_logger, setup_logging
from .runlog import STATUS_SKIPPED, PipelineRun, stage_run

log = get_logger("amr.pipeline.dock")


def mark_stale_runs(conn: sqlite3.Connection) -> int:
    """Close out docking runs left RUNNING by a process that has since ended.

    This prototype docks in a single process, so any run still flagged RUNNING
    when a new one starts was interrupted. Leaving it as RUNNING would make the
    dashboard claim work is in progress that never finished. Poses already
    scored by that run are kept: they are real results.
    """
    cursor = conn.execute(
        """UPDATE docking_runs
           SET status = 'INTERRUPTED', finished_at = ?,
               error = COALESCE(error, 'process ended before the run completed')
           WHERE status = 'RUNNING'""",
        (utcnow(),),
    )
    conn.commit()
    return cursor.rowcount if cursor.rowcount > 0 else 0


def register_targets(conn: sqlite3.Connection, targets: list[TargetSpec]) -> None:
    """Store the declared targets so the dashboard can explain every score."""
    for t in targets:
        conn.execute(
            """INSERT INTO targets(target_key, pathogen_key, name, gene, pdb_id, chain,
                   uniprot, site_mode, site_reference, box_size_x, box_size_y, box_size_z,
                   structure_url, status, selection_notes)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)
               ON CONFLICT(target_key) DO UPDATE SET
                   name = excluded.name, pdb_id = excluded.pdb_id, chain = excluded.chain,
                   site_mode = excluded.site_mode, site_reference = excluded.site_reference,
                   selection_notes = excluded.selection_notes""",
            (
                t.target_key, t.pathogen_key, t.name, t.gene, t.pdb_id, t.chain,
                t.uniprot, t.site_mode, t.site_reference,
                t.box_size[0], t.box_size[1], t.box_size[2], t.structure_url,
                t.selection_notes,
            ),
        )
    conn.commit()


def candidates_for_target(
    conn: sqlite3.Connection, cfg: Config, target: TargetSpec, limit: int
) -> list[sqlite3.Row]:
    """Top predicted candidates for the target's pathogen that are not yet docked."""
    threshold = float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
    dock_cfg = cfg.get("docking", default={}) or {}
    max_heavy = int(dock_cfg.get("max_ligand_heavy_atoms", 60))
    max_rotatable = int(dock_cfg.get("max_ligand_rotatable_bonds", 15))

    return conn.execute(
        """
        SELECT p.molecule_id, p.probability, m.canonical_smiles,
               m.heavy_atoms, m.rotatable_bonds,
               COALESCE(d.generic_name, m.pref_name, p.molecule_id) AS display_name
        FROM predictions p
        JOIN molecules m ON m.molecule_id = p.molecule_id
        LEFT JOIN (SELECT molecule_id, MIN(generic_name) AS generic_name FROM drugs
                   GROUP BY molecule_id) d ON d.molecule_id = p.molecule_id
        WHERE p.pathogen_key = ?
          AND p.probability >= ?
          AND m.canonical_smiles IS NOT NULL
          -- Flexibility guard: see docking.max_ligand_* in configs/config.yaml.
          AND COALESCE(m.heavy_atoms, 0) <= ?
          AND COALESCE(m.rotatable_bonds, 0) <= ?
          AND p.model_version = (
              SELECT model_version FROM model_versions
              WHERE pathogen_key = ? AND status = 'ACTIVE'
              ORDER BY training_date DESC LIMIT 1)
          AND NOT EXISTS (
              SELECT 1 FROM docking_results dr
              WHERE dr.molecule_id = p.molecule_id AND dr.target_key = ? AND dr.status = 'ok')
        GROUP BY p.molecule_id
        ORDER BY p.probability DESC
        LIMIT ?
        """,
        (target.pathogen_key, threshold, max_heavy, max_rotatable,
         target.pathogen_key, target.target_key, limit),
    ).fetchall()


def count_excluded_by_size(conn: sqlite3.Connection, cfg: Config, target: TargetSpec) -> int:
    """Candidates skipped purely because they exceed the flexibility guard."""
    threshold = float(cfg.get("screening", "candidate_probability_threshold", default=0.6))
    dock_cfg = cfg.get("docking", default={}) or {}
    row = conn.execute(
        """SELECT COUNT(DISTINCT p.molecule_id) FROM predictions p
           JOIN molecules m ON m.molecule_id = p.molecule_id
           WHERE p.pathogen_key = ? AND p.probability >= ?
             AND (COALESCE(m.heavy_atoms, 0) > ? OR COALESCE(m.rotatable_bonds, 0) > ?)""",
        (target.pathogen_key, threshold,
         int(dock_cfg.get("max_ligand_heavy_atoms", 60)),
         int(dock_cfg.get("max_ligand_rotatable_bonds", 15))),
    ).fetchone()
    return int(row[0] or 0)


def dock_target(
    conn: sqlite3.Connection, cfg: Config, run: PipelineRun, target: TargetSpec,
    binary: Path, *, limit: int, work_dir: Path, http: HttpClient,
) -> None:
    """Prepare the receptor and dock the top candidates for one target."""
    try:
        receptor = prepare_receptor(cfg, target, http=http)
    except ReceptorPreparationError as exc:
        conn.execute(
            "UPDATE targets SET status = 'failed', error = ? WHERE target_key = ?",
            (str(exc)[:1000], target.target_key),
        )
        conn.commit()
        run.record_error(f"receptor:{target.target_key}", exc)
        return

    conn.execute(
        """UPDATE targets SET status = 'ready', error = NULL, receptor_path = ?,
               box_center_x = ?, box_center_y = ?, box_center_z = ?, prepared_at = ?
           WHERE target_key = ?""",
        (
            str(receptor.receptor_pdbqt), receptor.box_center[0], receptor.box_center[1],
            receptor.box_center[2], utcnow(), target.target_key,
        ),
    )
    conn.commit()

    candidates = candidates_for_target(conn, cfg, target, limit)
    excluded = count_excluded_by_size(conn, cfg, target)
    if excluded:
        log.info(
            "%s: %d candidate(s) excluded by the ligand flexibility guard "
            "(too large or too flexible for a reliable Vina search)",
            target.target_key, excluded,
        )
        run.note(f"{target.target_key}_excluded_by_size", excluded)
    if not candidates:
        log.info("%s: no undocked candidates above the screening threshold", target.target_key)
        return

    dock_cfg = cfg.get("docking", default={}) or {}
    run_id = f"DOCK-{uuid.uuid4().hex[:10]}"
    engine_version = vina_version(binary)

    conn.execute(
        """INSERT INTO docking_runs(run_id, target_key, pathogen_key, engine, engine_version,
               exhaustiveness, num_modes, energy_range, random_seed,
               box_center_x, box_center_y, box_center_z, box_size_x, box_size_y, box_size_z,
               receptor_pdbqt, n_ligands, n_succeeded, n_failed, started_at, status)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?, 'RUNNING')""",
        (
            run_id, target.target_key, target.pathogen_key, "AutoDock Vina", engine_version,
            int(dock_cfg.get("exhaustiveness", 8)), int(dock_cfg.get("num_modes", 9)),
            float(dock_cfg.get("energy_range", 3)), int(dock_cfg.get("seed", 42)),
            receptor.box_center[0], receptor.box_center[1], receptor.box_center[2],
            receptor.box_size[0], receptor.box_size[1], receptor.box_size[2],
            str(receptor.receptor_pdbqt), len(candidates), utcnow(),
        ),
    )
    conn.commit()

    succeeded = failed = 0
    ligand_dir = work_dir / "ligands"
    pose_dir = work_dir / "poses" / target.target_key

    for row in candidates:
        run.processed += 1
        molecule_id = row["molecule_id"]
        try:
            ligand_path = prepare_ligand(
                row["canonical_smiles"],
                ligand_dir / f"{molecule_id}.pdbqt",
                seed=int(dock_cfg.get("ligand_conformer_seed", 42)),
            )
            result = dock_ligand(
                cfg,
                binary=binary,
                receptor_pdbqt=receptor.receptor_pdbqt,
                ligand_pdbqt=ligand_path,
                center=receptor.box_center,
                size=receptor.box_size,
                out_path=pose_dir / f"{molecule_id}.pdbqt",
                timeout_seconds=int(dock_cfg.get("per_ligand_timeout_seconds", 600)),
            )

            conn.executemany(
                """INSERT INTO docking_results(run_id, molecule_id, target_key, pathogen_key,
                       pose_rank, score_kcal_mol, rmsd_lb, rmsd_ub, pose_path, status,
                       error, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,'ok',NULL,?)
                   ON CONFLICT(run_id, molecule_id, pose_rank) DO UPDATE SET
                       score_kcal_mol = excluded.score_kcal_mol""",
                [
                    (
                        run_id, molecule_id, target.target_key, target.pathogen_key,
                        pose.rank, pose.score_kcal_mol, pose.rmsd_lb, pose.rmsd_ub,
                        str(result.out_path), utcnow(),
                    )
                    for pose in result.poses
                ],
            )
            conn.commit()
            succeeded += 1
            run.new += 1
            log.info(
                "%s | %s: best score %.2f kcal/mol",
                target.target_key, row["display_name"], result.best_score,
            )
        except (LigandPreparationError, VinaError) as exc:
            failed += 1
            run.record_error(f"dock:{target.target_key}:{molecule_id}", exc)
            conn.execute(
                """INSERT INTO docking_results(run_id, molecule_id, target_key, pathogen_key,
                       pose_rank, score_kcal_mol, rmsd_lb, rmsd_ub, pose_path, status,
                       error, created_at)
                   VALUES(?,?,?,?,0,NULL,NULL,NULL,NULL,'failed',?,?)
                   ON CONFLICT(run_id, molecule_id, pose_rank) DO UPDATE SET error = excluded.error""",
                (run_id, molecule_id, target.target_key, target.pathogen_key, str(exc)[:1000], utcnow()),
            )
            conn.commit()
        except Exception as exc:
            failed += 1
            run.record_error(f"dock:{target.target_key}:{molecule_id}", exc)

    conn.execute(
        """UPDATE docking_runs SET finished_at = ?, status = ?, n_succeeded = ?, n_failed = ?
           WHERE run_id = ?""",
        (utcnow(), "SUCCESS" if failed == 0 else "PARTIAL", succeeded, failed, run_id),
    )
    conn.commit()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Dock top candidates with AutoDock Vina")
    parser.add_argument("--target", type=str, default=None, help="dock only this target key")
    parser.add_argument("--limit", type=int, default=None, help="candidates per target")
    args = parser.parse_args(argv)

    cfg = load_config()
    setup_logging(cfg.path_for("logs"))
    cfg.ensure_directories()

    targets, _ = load_targets()
    if args.target:
        targets = [t for t in targets if t.target_key == args.target]
        if not targets:
            log.error("no target named %r in configs/targets.yaml", args.target)
            return 2

    limit = args.limit or int(cfg.get("docking", "max_candidates_per_target", default=25))
    work_dir = PROJECT_ROOT / "data" / "processed" / "docking"

    with session(cfg) as conn:
        init_db(conn, cfg)
        register_targets(conn, targets)
        stale = mark_stale_runs(conn)
        if stale:
            log.info("closed %d interrupted docking run(s) from a previous process", stale)

        with stage_run(conn, "dock", params=vars(args)) as run:
            if not cfg.get("docking", "enabled", default=True):
                run.status = STATUS_SKIPPED
                run.message = "docking disabled in configuration"
                return 0

            binary = cfg.resolve_vina_binary()
            if binary is None:
                run.status = STATUS_SKIPPED
                run.message = (
                    "AutoDock Vina executable not found. Set AMR_VINA_BIN or docking.vina_binary. "
                    "The rest of the pipeline is unaffected."
                )
                log.warning(run.message)
                conn.execute("UPDATE targets SET status = 'unavailable', error = ?", (run.message,))
                conn.commit()
                return 0

            run.note("vina", vina_version(binary))
            http = HttpClient(cfg)
            try:
                for target in targets:
                    dock_target(conn, cfg, run, target, binary,
                                limit=limit, work_dir=work_dir, http=http)
            finally:
                http.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
