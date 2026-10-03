# Kaggle docking workers

Free Kaggle notebook sessions can run extra AutoDock Vina workers for the
batch docking campaign (1,761 medicines × 4 targets = 7,044 jobs, see
`docs/BATCH_DOCKING.md`). They join the laptop worker on the same queue:

```
                  Supabase
          Postgres `docking` schema + Storage bucket `docking-artifacts`
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
    laptop        Kaggle #1      Kaggle #2  …
  Docker worker   notebook       notebook
```

Nothing about the science changes. A Kaggle worker runs the project's own
`src/batchdock` code, cloned from the public repository, with the official
AutoDock Vina 1.2.5 Linux binary (checked against a pinned SHA-256). Before it
claims anything the notebook recomputes the configuration hash and refuses to
run unless it equals the validated one:

```
vina-1.2.5/exh8/modes9/seed42/batchdock-2
5965905fa46e4af8a9486af0edc3de11cf50c7f21326053e1f7266715cbcf2b7
```

That is exhaustiveness 8, 9 modes, energy range 3 kcal/mol, seed 42, a
22 × 22 × 22 Å box, the validated receptors with their cofactors, and the same
prepared ligand files. Inputs are downloaded, never re-prepared; each file is
checked against the SHA-256 recorded in `docking.artifacts`.

Use only what Kaggle offers an account for free, under its terms: one Kaggle
account, sessions within its limits. No billing, no paid accelerators.

## 1. Create the notebook

1. On kaggle.com: **Create → New Notebook → File → Import Notebook**, and
   upload `kaggle/docking_worker.ipynb` from this repository.
2. In the notebook's right-hand panel (**Settings**):
   * **Accelerator: None** (CPU). Production runs on CPU Vina.
   * **Internet: On**. Kaggle requires a phone-verified account for this. The
     worker needs the internet for the database, the storage bucket, GitHub
     and the Vina binary.
   * Persistence and environment: defaults.

## 2. Add the Kaggle Secrets

**Add-ons → Secrets → Add a new secret**, three times, and tick the box to
attach each one to this notebook:

| Label | Value (from `docking.env` on the laptop) |
| --- | --- |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SECRET_KEY` | the Supabase secret (service) key |
| `DOCKING_DATABASE_URL` | the pooler connection string, port 6543 |

The notebook reads them with `kaggle_secrets.UserSecretsClient` and prints only
"present" or "MISSING". Never paste a value into a cell: a saved notebook
version keeps its source, and `kaggle/docking_worker.ipynb` in this repository
must stay free of credentials. Keep the notebook **private**.

## 3. Start a worker

Click **Save Version → Save & Run All (Commit) → Save**. A committed run keeps
going with the browser closed, until the queue is empty or the session limit.

What it does, cell by cell:

1. reports CPUs (affinity and cgroup quota), memory and the CPU model;
2. loads the three secrets;
3. clones the repository at `REPO_REF` (default `master`) and prints the commit;
4. installs psycopg, RDKit and Meeko 0.8.0, and checks that they import and run;
5. downloads Vina 1.2.5, verifies its SHA-256 and `vina --version`;
6. connects to the queue, checks the configuration hash, prints the campaign;
7. downloads the four receptors once into
   `/kaggle/working/docking-cache/receptors` and verifies them; ligands are
   fetched the first time a job needs one into
   `/kaggle/working/docking-cache/ligands`, verified, and reused all session;
8. reports whether a GPU is attached (probe only, see below);
9. calibrates: 1, 2, 3, then 4 slots (one single-threaded Vina per slot,
   `DOCKING_CPU_PER_JOB=1`), each phase docking `slots × 3` real queue jobs,
   and keeps the slot count with the highest steady-state rate among phases
   without failures, never more slots than CPUs;
10. runs the worker: claim → fetch inputs → Vina → check → store → complete,
    repeated, printing campaign progress every 10 minutes. It stops claiming
    after 11.5 h (before Kaggle's 12 h limit) and leaves earlier if the queue
    has been empty for 15 minutes;
11. prints the campaign status.

Calibration costs nothing: every calibration job is a normal production job
and its result is kept. To skip it, set `CALIBRATE = False` and `FIXED_SLOTS`.

## 4. Run more than one worker

Each worker claims the next available job itself, so more workers need no
setup: no job ranges, no second queue. To start another, commit the notebook
again (or **Copy & Edit** it into a second notebook with the same secrets
attached and commit that). Kaggle caps how many sessions one account may run
at the same time; the **Your Work → active sessions** panel shows what is
running. Do not use more than one account.

The laptop keeps its 8 Docker slots: `npm run docking:worker`.

## 5. Monitor

* Website: `/docking` (refreshes every 15 s). Totals, completed, running,
  queued, docking failures, input unavailable, workers and slots by location
  (Local, Kaggle, Total), throughput over the last 15 minutes and an ETA. Each
  online worker is listed with its CPUs, slots, running job ids, completed
  jobs, jobs/min and last heartbeat.
* Terminal: `npm run docking:status` (or `python -m src.batchdock status`).
* API: `GET /api/docking/status` → `workers.byKind` and `workers.list`.
* The notebook's own log: one line per job, a campaign summary every 10 min.

The ETA is remaining jobs divided by the measured completions of the last 15
minutes, and is withheld until at least 10 jobs completed in that window. Jobs
run cheapest first (fewest torsions), so the rate falls as larger ligands come
up and the ETA rises with it; that is the measurement, not an error.

## 6. Stop a worker safely

* Interactive session: **interrupt the kernel** (■). The worker stops
  claiming, lets running Vina jobs finish for up to 15 minutes, then hands any
  unfinished job back to the queue without counting the attempt.
* Committed run: **Your Work → the running version → Stop session**, or just
  let it reach 11.5 h. A hard stop is also safe; see the next section.
* Everywhere at once: `npm run docking:pause` (every worker finishes its
  current job and claims nothing new); `npm run docking:resume` to continue.

## 7. What happens when a session ends

Every RUNNING job has a 180 s lease, renewed every 45 s by the heartbeat. When
a Kaggle session is killed, its heartbeat stops; within about three minutes
any other worker's stale-job recovery returns those jobs to `QUEUED` (or marks
them `FAILED` on their final attempt), and the next free slot anywhere claims
them. A result is written only in the same statement that marks the job
`COMPLETED`, and only while the writer still holds the lease, so a job cut off
halfway leaves no partial result. Completed jobs are never re-queued.

## 8. Check for duplicates

```sql
-- both must return no rows
select ligand_id, target_id, config_hash, count(*) from docking.results
 group by 1, 2, 3 having count(*) > 1;
select job_id, count(*) from docking.results group by 1 having count(*) > 1;

-- every COMPLETED job has its result, and no other job has one: both 0
select count(*) from docking.jobs j where j.status = 'COMPLETED'
   and not exists (select 1 from docking.results r where r.job_id = j.id);
select count(*) from docking.results r join docking.jobs j on j.id = r.job_id
 where j.status <> 'COMPLETED';
```

The unique constraints (`docking.jobs` on ligand + target + configuration,
`docking.results` on job and on ligand + target + configuration) make a
duplicate impossible rather than unlikely. `npm run docking:validate` runs
these and further quality checks.

## 9. Finish all 7,044

The campaign is done when every job is in a terminal state:

```
completed + docking failed + input unavailable (+ cancelled) = jobs in scope
```

Input-unavailable jobs (no structure, ligand or target could not be prepared)
were created terminal with their reason and are not docking failures.

1. Keep at least one worker running (laptop and/or Kaggle sessions); start a
   new Kaggle commit whenever one ends while jobs are still queued.
2. When `queued` and `running` reach 0, re-queue the docking failures once:
   `npm run docking:retry-failed`, and let a worker finish them.
3. `npm run docking:validate` and the duplicate checks above.
4. `npm run docking:status`: the run closes itself (`COMPLETED`) when no job
   is left queued or running.

## GPU

The notebook only probes for a GPU. Production stays on CPU AutoDock Vina
1.2.5 because Vina 1.2.5 has no GPU code path: a GPU docking engine (Uni-Dock,
Vina-GPU) is a different engine, whose results would form a different
configuration and could not be counted as this campaign's Vina 1.2.5 results.
The one measurement this project has, Uni-Dock on the laptop's GTX 1650, was
slower than CPU Vina. A GPU engine would need its own validation run
(redocking, as in `docs/BATCH_DOCKING.md`) and its own configuration hash
before any of its scores could be used.

## Files

| File | Role |
| --- | --- |
| `kaggle/docking_worker.ipynb` | the notebook (no credentials, no outputs) |
| `src/batchdock/calibrate.py` | 1..N slot calibration on real jobs (`python -m src.batchdock calibrate`) |
| `src/batchdock/config.py` | `DOCKING_WORKER_KIND` / `DOCKING_WORKER_LABEL`; cgroup-aware CPU count |
| `src/batchdock/progress.py`, `web/src/lib/queries/docking.ts` | workers by kind and per worker |
| `src/batchdock/schema.sql` | `docking.workers.kind`, `session_label` (idempotent `add column if not exists`) |
