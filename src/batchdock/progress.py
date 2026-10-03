"""Progress, computed from the database every time. Nothing here is stored or guessed.

Scope of a campaign: every library medicine (a ligand with a molecule_id) x
every selected target, under one configuration hash — whichever run created
or executed the job. Validation and benchmark jobs are real jobs under the same
configuration, so they count; they are never repeated.

Categories are kept apart on purpose:
  completed            Vina ran and a checked result is stored
  docking_failed       Vina was run and failed (timeout, crash, invalid output)
  input_unavailable    the medicine has no structure, its ligand could not be
                       prepared, or the target could not be prepared
Success rate is completed / (completed + docking_failed); input failures are
not docking failures and are not in the denominator.

The ETA is remaining jobs divided by the throughput measured over the last 15
minutes, and is withheld (None) until at least 10 jobs completed in that window.
"""

from __future__ import annotations

from typing import Any

from .queue import current_full_run

MIN_COMPLETIONS_FOR_ETA = 10


def campaign_status(conn, config_hash: str) -> dict[str, Any]:
    run_id = current_full_run(conn, config_hash)
    run = conn.execute(
        """select run_id, run_name, status, engine, engine_version, started_at, completed_at
             from docking.runs where run_id = %s""", (run_id,)).fetchone() if run_id else None

    medicines = conn.execute(
        "select count(distinct molecule_id) from amr.drugs where molecule_id is not null").fetchone()[0]
    targets = conn.execute(
        """select count(*), count(*) filter (where preparation_status = 'READY')
             from docking.targets where selected""").fetchone()
    ligands = conn.execute(
        """select count(*) filter (where preparation_status = 'READY'),
                  count(*) filter (where preparation_status = 'STRUCTURE_UNAVAILABLE'),
                  count(*) filter (where preparation_status = 'LIGAND_PREPARATION_FAILED'),
                  count(*) filter (where preparation_status = 'PENDING')
             from docking.ligands where molecule_id is not null""").fetchone()

    j = conn.execute(
        """select count(*),
                  count(*) filter (where j.status = 'QUEUED'),
                  count(*) filter (where j.status = 'RUNNING'),
                  count(*) filter (where j.status = 'COMPLETED'),
                  count(*) filter (where j.status in ('DOCKING_FAILED','FAILED')),
                  count(*) filter (where j.status = 'STRUCTURE_UNAVAILABLE'),
                  count(*) filter (where j.status = 'LIGAND_PREPARATION_FAILED'),
                  count(*) filter (where j.status = 'TARGET_PREPARATION_FAILED'),
                  count(*) filter (where j.status = 'CANCELLED'),
                  count(*) filter (where j.status = 'COMPLETED' and j.completed_at > now() - interval '5 minutes'),
                  count(*) filter (where j.status = 'COMPLETED' and j.completed_at > now() - interval '15 minutes'),
                  avg(j.duration_seconds) filter (where j.status = 'COMPLETED'),
                  min(j.started_at), max(j.completed_at) filter (where j.status = 'COMPLETED')
             from docking.jobs j join docking.ligands l on l.ligand_id = j.ligand_id
             join docking.targets t on t.target_id = j.target_id and t.selected
            where j.config_hash = %s and l.molecule_id is not null""", (config_hash,)).fetchone()
    (total, queued, running, completed, dock_failed, unavailable, lig_failed, tgt_failed,
     cancelled, done5, done15, avg_dur, first_start, last_done) = j
    total, queued, running, completed = int(total), int(queued), int(running), int(completed)

    processed = conn.execute(
        """select count(*) from (
               select j.ligand_id from docking.jobs j join docking.ligands l on l.ligand_id = j.ligand_id
                where j.config_hash = %s and l.molecule_id is not null
                group by j.ligand_id
               having count(*) filter (where j.status in ('QUEUED','RUNNING')) = 0) x""",
        (config_hash,)).fetchone()[0]
    workers = conn.execute(
        """select count(*), coalesce(sum(concurrency), 0) from docking.workers
            where status in ('RUNNING','STOPPING') and last_seen_at > now() - interval '3 minutes'""").fetchone()

    expected = int(medicines) * int(targets[0])
    remaining = queued + running
    finished = total - remaining
    rate5 = done5 / 5.0
    rate15 = done15 / 15.0
    eta_minutes = (remaining / rate15) if (done15 >= MIN_COMPLETIONS_FOR_ETA and rate15 > 0) else None
    attempted = completed + int(dock_failed)

    return {
        "runId": run[0] if run else None,
        "runName": run[1] if run else None,
        "runStatus": run[2] if run else None,
        "engine": run[3] if run else None,
        "engineVersion": run[4] if run else None,
        "startedAt": run[5].isoformat() if run and run[5] else None,
        "configHash": config_hash,
        "medicines": {"total": int(medicines), "processed": int(processed),
                      "remaining": int(medicines) - int(processed)},
        "ligands": {"ready": int(ligands[0]), "structureUnavailable": int(ligands[1]),
                    "preparationFailed": int(ligands[2]), "pending": int(ligands[3])},
        "targets": {"total": int(targets[0]), "ready": int(targets[1])},
        "jobs": {
            "expected": expected,
            "total": total,
            "notYetCreated": max(0, expected - total),
            "queued": queued, "running": running, "completed": completed,
            "dockingFailed": int(dock_failed),
            "structureUnavailable": int(unavailable),
            "ligandPreparationFailed": int(lig_failed),
            "targetPreparationFailed": int(tgt_failed),
            "cancelled": int(cancelled),
            "remaining": remaining,
            "finished": finished,
        },
        "percentFinished": round(100.0 * finished / expected, 2) if expected else 0.0,
        "percentCompleted": round(100.0 * completed / expected, 2) if expected else 0.0,
        "throughput": {"jobsPerMinute5m": round(rate5, 2), "jobsPerMinute15m": round(rate15, 2)},
        "etaMinutes": round(eta_minutes, 1) if eta_minutes is not None else None,
        "averageDockingSeconds": round(float(avg_dur), 1) if avg_dur is not None else None,
        "successRate": round(completed / attempted, 4) if attempted else None,
        "firstStartedAt": first_start.isoformat() if first_start else None,
        "lastCompletedAt": last_done.isoformat() if last_done else None,
        "workers": {"online": int(workers[0]), "slots": int(workers[1])},
    }


def format_status(s: dict[str, Any]) -> str:
    j = s["jobs"]
    lines = [
        f"run            {s['runId']} ({s['runStatus']})  engine {s['engine']} {s['engineVersion']}",
        f"configuration  {s['configHash'][:16]}",
        f"medicines      {s['medicines']['total']:,}  processed {s['medicines']['processed']:,}  "
        f"remaining {s['medicines']['remaining']:,}",
        f"ligands        ready {s['ligands']['ready']:,}  structure unavailable "
        f"{s['ligands']['structureUnavailable']:,}  preparation failed {s['ligands']['preparationFailed']:,}",
        f"targets        {s['targets']['ready']} ready of {s['targets']['total']}",
        f"jobs           {j['expected']:,} expected ({s['medicines']['total']:,} x {s['targets']['total']})"
        f"  created {j['total']:,}",
        f"               completed {j['completed']:,}  running {j['running']:,}  queued {j['queued']:,}",
        f"               docking failed {j['dockingFailed']:,}  structure unavailable "
        f"{j['structureUnavailable']:,}  ligand prep failed {j['ligandPreparationFailed']:,}  "
        f"target prep failed {j['targetPreparationFailed']:,}",
        f"finished       {s['percentFinished']}%  (completed {s['percentCompleted']}%)",
        f"throughput     {s['throughput']['jobsPerMinute15m']} jobs/min (15 min)  "
        f"{s['throughput']['jobsPerMinute5m']} jobs/min (5 min)",
        f"eta            {str(s['etaMinutes']) + ' min' if s['etaMinutes'] is not None else 'not enough recent completions to estimate'}",
        f"avg docking    {s['averageDockingSeconds']} s/job   success rate {s['successRate']}",
        f"workers        {s['workers']['online']} online, {s['workers']['slots']} slots",
    ]
    return "\n".join(lines)
