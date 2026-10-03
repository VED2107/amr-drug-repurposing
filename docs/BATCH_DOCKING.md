# Batch docking: every medicine against every target

Stage 04 (CHECK FIT) docks all 1,761 approved medicines in the library against
one experimentally solved protein from each of the four bacteria, with AutoDock
Vina 1.2.5. That is **1,761 × 4 = 7,044 docking jobs**. Every result is a real
Vina run whose score, poses, inputs, configuration and command are stored.

A docking score is computational evidence: a structural hypothesis about how a
molecule may fit one protein pocket. It ranks candidates for further study. It
is not clinical evidence and does not show that a medicine treats an infection.

## Architecture

```
Website (Vercel)  ──reads──▶  Supabase Postgres  ◀──claims / writes──  Docking worker(s) (Docker, any machine)
   /docking                    schema `docking`                         AutoDock Vina 1.2.5, 1 thread per slot
   /api/docking/*              (queue + results)                              │
                               Supabase Storage  ◀──────── pose / log / ligand / receptor files (SHA-256 checked)
                               bucket docking-artifacts (private)
```

* **Queue.** `docking.jobs`, one row per (ligand, target, configuration hash),
  unique. Workers claim with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
  LOCKED)`, so any number of workers on any number of machines never receive
  the same job and fast workers simply take more.
* **Leases.** A claimed job carries `lease_expires_at`; each worker's heartbeat
  extends it every 45 s. A job whose worker vanished returns to `QUEUED` after
  the lease (180 s) expires, or becomes `FAILED` on its final attempt.
* **Completion** is one statement that marks the job `COMPLETED` and inserts
  its result only if the worker still holds the lease. `docking.results` is
  unique per job and per (ligand, target, configuration): a duplicate result is
  impossible.
* **Retries.** Transient failures (worker crash, storage or database hiccup)
  go back to the queue with exponential backoff (30 s, 60 s, 120 s … capped at
  15 min) up to `DOCKING_RETRIES`. A Vina timeout or invalid output is
  terminal (`DOCKING_FAILED`) and can be requeued with `retry-failed`.
* **Inputs are prepared once.** 1,761 ligand PDBQT files and 4 receptor PDBQT
  files are produced by `prepare`, stored with their SHA-256, and reused by
  every job. A worker without a file fetches it from storage and refuses it if
  its checksum differs.
* **Not in Vercel.** The website only reads progress and results and can
  requeue jobs. Docking runs only in the worker containers.

## Status values

| Status | Meaning |
| --- | --- |
| `QUEUED` / `RUNNING` | waiting / claimed by a worker under a lease |
| `COMPLETED` | Vina ran; a checked result is stored |
| `DOCKING_FAILED` | Vina ran and failed: timeout, crash, empty or inconsistent output |
| `FAILED` | infrastructure failure on the final attempt (lease expired, storage) |
| `STRUCTURE_UNAVAILABLE` | the medicine has no recorded structure |
| `LIGAND_PREPARATION_FAILED` | a structure exists but cannot become a valid dockable ligand (e.g. an element Vina has no parameters for, several components, a SMILES that does not match its InChIKey) |
| `TARGET_PREPARATION_FAILED` | the receptor or its binding site could not be prepared as declared |

Success rate is `completed / (completed + docking failures)`. Input failures
are not docking failures and are not in the denominator.

## Scientific protocol (configuration `vina-1.2.5/exh8/modes9/seed42/batchdock-2`, hash `5965905fa46e4af8…`)

| Parameter | Value |
| --- | --- |
| Engine | AutoDock Vina 1.2.5 (official Linux build, SHA-256 pinned in `Dockerfile.docking`) |
| Exhaustiveness | 8 (Vina default) |
| Modes / energy range | 9 / 3 kcal/mol |
| Seed | 42 (deterministic: identical poses and scores at `--cpu 1`, 4 and 8, verified) |
| Box | 22 × 22 × 22 Å, centred on the co-crystallised ligand or catalytic residues (`configs/targets.yaml`) |
| Receptor | single chain, protein atoms, altloc A, Meeko 0.8.0 `mk_prepare_receptor`; the bound cofactor (NADPH in 3FRE, NADP+ in 1RX2, NAD+ in 4TZK) kept as rigid receptor atoms at its crystal coordinates |
| Ligand | standardised parent SMILES → RDKit ETKDGv3 (seed 42) → MMFF94 → Meeko 0.8.0 → PDBQT |

The configuration is content-addressed: its SHA-256 (`config_hash`) covers
every parameter that can change a score. `DOCKING_EXHAUSTIVENESS` creates a
different configuration and a different set of jobs; it never relabels
existing results. The thread count per job is operational, not scientific.

## Validation (run before the full batch; the full run refuses to start without a pass)

Redocking the co-crystallised ligand into its own structure, pass = a pose within
2.5 Å (symmetry-aware heavy-atom RMSD, no superposition) among the top three,
criterion fixed before the first run:

| Target | Ligand | Protocol 1 (cofactor removed) | Protocol 2 (cofactor kept) |
| --- | --- | --- | --- |
| S. aureus DHFR, 3FRE | trimethoprim (TOP) | 5.59 / 5.50 / 3.75 Å: fail | **0.83** / 0.87 / 6.64 Å: pass |
| E. coli DHFR, 1RX2 | folate (FOL) | 6.05 / 5.74 / 4.88 Å: fail | **1.17** / 8.73 / 8.97 Å: pass |
| M. tuberculosis InhA, 4TZK | inhibitor 641 | 12.62 / 2.92 / 9.03 Å: fail | **1.45** / 1.37 / 3.88 Å: pass |

Without the cofactor, the ligands moved into the empty cofactor cleft. Both
validation runs are kept in `docking.runs` (`VAL-20261003-064635-ef7ee9`
failed, `VAL-20261003-065821-e93daf` passed). KPC-2 (2OV5) has no
co-crystallised ligand and no cofactor; it is validated only by execution
(meropenem docks, 9 poses).

## Commands

From the repository root (Docker required; credentials in `docking.env`):

```bash
npm run docking:build            # build the worker image
npm run docking:migrate          # create the `docking` schema and the storage bucket
npm run docking:prepare          # 4 receptors + 1,761 ligands, once
npm run docking:validation-run   # redocking + known pairs; gates the full run
npm run docking:enqueue          # create every missing medicine x target job
npm run docking:worker           # start the long-lived worker (DOCKING_CONCURRENCY slots)
npm run docking:status           # progress, computed from the database
npm run docking:resume           # requeue stalled jobs, unpause, start the worker
npm run docking:retry-failed     # requeue docking failures
npm run docking:validate         # quality-control checks
npm run docking:test             # tests, including a real Vina run
```

`docking.env` (gitignored):

```
DOCKING_DATABASE_URL=postgresql://…pooler.supabase.com:6543/postgres
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SECRET_KEY=…
```

Operational settings: `DOCKING_CONCURRENCY` (default: CPUs − 1),
`DOCKING_CPU_PER_JOB` (1), `DOCKING_TIMEOUT` (1800 s), `DOCKING_RETRIES` (2),
`DOCKING_LEASE_SECONDS` (180), `DOCKING_ARTIFACT_DIR` (local cache).

## Adding machines

Free Kaggle notebook sessions can join the same queue as extra workers:
`kaggle/docking_worker.ipynb`, set up as described in `docs/KAGGLE_DOCKING.md`.

Workers share nothing but the database and the bucket. On any Linux machine
with Docker:

```bash
docker build -f Dockerfile.docking -t amr-docking:latest .
docker run -d --restart unless-stopped --env-file docking.env \
  -e DOCKING_CONCURRENCY=$(( $(nproc) - 1 )) amr-docking:latest worker
```

Each additional CPU core adds roughly one Vina job per average job time.

## Website

* `/docking`: live progress (refreshed every 15 s), campaign figures, engine
  and configuration, per-target coverage, filterable results.
* `/docking/<job>`: one result with every pose, provenance and downloads.
* `/api/docking/status`, `/api/docking/results`, `/api/docking/results/<job>`,
  `/api/docking/artifacts/<id>` (checksum-verified download).
* `POST /api/docking/retry-failed`, `POST /api/docking/resume`: need
  `Authorization: Bearer $DOCKING_OPERATOR_TOKEN`; disabled when unset.
