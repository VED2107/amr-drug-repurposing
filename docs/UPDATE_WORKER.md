# The AMR update worker

A container that finds newly approved medicines, scores them with the models
that are already in service, and writes the results to Supabase. The website
shows them on the next page request, with no rebuild or redeploy.

```
ChEMBL + FDA Orange Book
          ↓
  Dockerised update worker      ← the only containerised component
          ↓
  RF-mrsa-v4 · RF-ecoli-v4 · RF-kpneumoniae-v5 · RF-mtb-v5
          ↓
        Supabase                ← external, unchanged
          ↓
   Next.js website              ← external, unchanged
```

## What it does

1. Validates its configuration and loads all four ACTIVE models **before**
   contacting any source. Each artifact's SHA-256 is checked before it is
   unpickled, and the run does not start until the container has reproduced
   20 published predictions (see [Model integrity](#model-integrity)).
2. Reads the published database to learn which medicines already exist. That is
   the only reliable record of what has been done; there is no separate
   bookkeeping table and no local state file to fall out of sync.
3. Reads ChEMBL's approved molecules and the FDA Orange Book through the same
   clients the local pipeline uses.
4. For each medicine not already published: standardises the structure,
   computes the 1024-bit Morgan fingerprint and the descriptors, and scores it
   against all four models.
5. Writes the molecule, its approved products and its four predictions to
   Supabase, one medicine per transaction.
6. Records the run, the sources consulted and any per-item failures in
   `pipeline_runs`, `data_sources` and `pipeline_errors`.

## What it does not contain

No Next.js, no frontend source, no frontend build, no Vercel configuration, no
PostgreSQL, no Supabase, no research database, and no AutoDock Vina. The image
holds a Python runtime, RDKit, scikit-learn, the engine's own source, and four
model artifacts. Supabase is reached over the network and stays entirely
external.

## What it will never do

The worker performs **inference only**. It does not train, does not create or
promote a model version, does not write to `dataset_versions`,
`dataset_members`, `bioactivity` or `model_versions`, and does not invent an
activity label. A newly approved medicine is data to score, not data to learn
from.

Three guarantees are enforced in code rather than by convention:

| Guarantee | Where |
| --- | --- |
| No training or promotion call exists anywhere in the worker | `tests/test_update_worker.py::test_the_worker_never_imports_training_code`, which parses the AST rather than grepping |
| Only `molecules`, `drugs`, `predictions`, `pipeline_runs`, `pipeline_errors` and `data_sources` are written | `test_store_writes_no_table_outside_the_published_schema` |
| Only the four supported pathogens are ever scored | `src/updater/config.py:SUPPORTED_PATHOGENS`, checked in `test_only_the_four_supported_pathogens_can_be_scored` |

If the published registry's ACTIVE models stop matching the four this image was
built for, the run **stops** rather than scoring with an unreviewed model. Set
`AMR_REQUIRE_EXPECTED_MODELS=0` once you have checked the change is intended.

A medicine with no usable structure is skipped and counted. It is never
completed from another source and never given a placeholder molecule.

## Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `AMR_DATABASE_URL` | **yes** | — | Supabase Postgres connection string. `DATABASE_URL` and `SUPABASE_DB_URL` are also accepted. Never logged. |
| `AMR_MODELS_DIR` | no | `/app/models` | Where the artifacts live inside the container |
| `AMR_MAX_NEW_MEDICINES` | no | `500` | Upper bound per run, so a first run is bounded |
| `AMR_DRY_RUN` | no | `0` | Do everything except write |
| `AMR_REQUIRE_EXPECTED_MODELS` | no | `1` | Stop if the ACTIVE models are not the expected four |
| `AMR_CONTACT_EMAIL` | no | — | Sent in the user agent, as the public APIs ask |
| `AMR_LOG_LEVEL` | no | `INFO` | `DEBUG` for the full record |
| `AMR_OFFLINE` | no | `0` | Skip the source fetch entirely |

Put them in a `worker.env` file, which is gitignored:

```ini
AMR_DATABASE_URL=postgresql://...@...pooler.supabase.com:6543/postgres
AMR_CONTACT_EMAIL=you@example.com
AMR_MAX_NEW_MEDICINES=500
```

**Never commit that file, and never pass the connection string on the command
line** — it would land in your shell history and in `docker inspect`.

## Build

From the repository root, because the build context includes `src/`,
`configs/` and the four model artifacts:

```bash
docker build -f Dockerfile.worker -t amr-worker:latest .
```

The image is roughly 1.6 GB: RDKit and scikit-learn account for most of it, and
the four models add about 167 MB. `.dockerignore` keeps the website, the
research database, the 1.2 GB of non-production model versions and every `.env`
out of the build context.

## Run

**Check everything without writing** — validates configuration, loads all four
models, queries the registry, then exits:

```bash
docker run --rm --env-file worker.env amr-worker:latest --check
```

**A dry run** — the full source sweep and new-medicine detection, reporting what
it *would* publish:

```bash
docker run --rm --env-file worker.env amr-worker:latest --dry-run
```

**A real update:**

```bash
docker run --rm --env-file worker.env amr-worker:latest
```

**Bounded first run**, recommended the first time:

```bash
docker run --rm --env-file worker.env amr-worker:latest --limit 25
```

**Trace one medicine end to end**, writing nothing. This reads the live ChEMBL
record, standardises it, fingerprints it, scores it with the four verified models
and compares every probability with Supabase:

```bash
docker run --rm --env-file worker.env amr-worker:latest --trace CHEMBL295698
```

**Artifacts from a mount** instead of the baked-in copies. A mounted file must
have the same SHA-256 as the pinned one; any other file is refused. To use a
different model, follow [Updating the model version safely](#updating-the-model-version-safely):

```bash
docker run --rm --env-file worker.env \
  -v "$PWD/models:/models:ro" -e AMR_MODELS_DIR=/models \
  amr-worker:latest --check
```

**From this PC, disconnect Cloudflare WARP first** (`warp-cli disconnect`, and
`warp-cli connect` afterwards). WARP's 1280-byte tunnel loses large replies
from Supabase: the run fails with `SSL error: unexpected eof` on its first big
read.

On Windows PowerShell, replace `$PWD` with `${PWD}`.

## Running it on a schedule

The worker is a batch job: it starts, does one sweep, and exits. Exit code `0`
means success, `1` means the run finished with per-item errors, and anything
higher means it stopped before doing work (`2` configuration, `3` database,
`4` no ACTIVE model, `5` model mismatch).

Weekly is a sensible cadence — the Orange Book updates monthly and ChEMBL a few
times a year, so running hourly would mostly re-read unchanged sources.

**Windows Task Scheduler:**

```powershell
schtasks /create /tn "AMR update" /sc weekly /d SUN /st 03:00 ^
  /tr "docker run --rm --env-file C:\PROJECTS\AMR\worker.env amr-worker:latest"
```

**cron:**

```cron
0 3 * * 0 docker run --rm --env-file /srv/amr/worker.env amr-worker:latest
```

**Any container host with scheduled jobs** (Cloud Run Jobs, ECS Scheduled Tasks,
Azure Container Apps Jobs, Kubernetes `CronJob`) takes the same image and the
same environment variables. Two rules for all of them: **do not enable retries**,
because a retried run would re-read sources a completed run already processed;
and **do not run two at once** — the worker is safe to rerun, but concurrent runs
would duplicate work for no benefit.

## Idempotence and restarting

Running twice produces the same database as running once:

- `molecules` upserts on `molecule_id`, preserving identifiers already present.
- `drugs` upserts on `drug_id`.
- `predictions` inserts with `on conflict (molecule_id, pathogen_key,
  model_version) do nothing`. An existing prediction is never rewritten: the
  same model over the same fingerprint gives the same number, and `predicted_at`
  is a record of when that number was actually produced.

Each medicine is written in its own transaction, so an interrupted run leaves
whole medicines published and the next run continues with the rest. There is no
resume file to corrupt — "what is already published" is read from the database
at the start of every run.

## Where the models live

**Inside the image**, at `/app/models`. They are copied by name from `models/`
at build time, and only the four ACTIVE artifacts are included:

| Pathogen | Version | File | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| MRSA | RF-mrsa-v4 | `RF-mrsa-v4.joblib` | 45,186,232 | `043e8f8805fe4308ba45d347a34c7a5d62aed05728bd44e296e836708bac27bc` |
| E. coli | RF-ecoli-v4 | `RF-ecoli-v4.joblib` | 43,909,018 | `921ec3ce6cd9ebd9bffc57fa1dfe01e02d0d92ed24337f03cb8a3558bc20f528` |
| K. pneumoniae | RF-kpneumoniae-v5 | `RF-kpneumoniae-v5.joblib` | 35,362,134 | `7a0f358c8d57b4c1456260389035d621cc4bdb8c6e7fa0872a8ba66fbde63917` |
| M. tuberculosis | RF-mtb-v5 | `RF-mtb-v5.joblib` | 48,535,510 | `2c9559211e9b274b6858fdc286fc42087cc95c4c84266aecb9827319d49c864c` |

All four are random forests trained on dataset `DS-20260921-fe8c6cb8-78df2c`
with features `morgan-r2-1024-v1`, under scikit-learn 1.9.1, NumPy 2.5.3 and
RDKit 2026.03.6. `requirements-worker.txt` pins the same versions. The table is
generated: `src/updater/model_manifest.json` is the source, written by
`scripts/build_worker_manifest.py` from the files and the research database.

**Why baked in rather than mounted.** 167 MB is small next to the 1.2 GB image
base, and baking them in makes the image the unit of deployment. An image tag
then identifies exactly which bytes score new medicines, the container runs on
any host without a second artifact to ship, and nothing can drift between the
image and a volume. A mount is still accepted for the same bytes, but a mount is
not how a different model gets in.

The registry column `model_versions.artifact_path` records an absolute Windows
path from the machine that trained the model. That cannot resolve in a
container, so the worker looks for the artifact by **file name** inside
`AMR_MODELS_DIR` first, then `<model_version>.joblib`, and only then the
recorded path. This is a lookup change, not a science change: the same file is
loaded by the same `joblib` call and scored by the same function the pipeline
uses.

## Updating the model version safely

1. Train and promote locally, through the existing pipeline. The worker has no
   part in this.
2. Publish the new `model_versions` row and its predictions to Supabase.
3. Copy the new artifact into `models/`.
4. Update `EXPECTED_ACTIVE_MODELS` in `src/updater/config.py` and the `COPY`
   list in `Dockerfile.worker`.
5. Run `python scripts/build_worker_manifest.py` to re-pin checksums and known
   answers from the research database.
6. Rebuild the image. The build fails if an artifact does not match the
   manifest. Then run `--check`, which refuses to start if the registry, the
   manifest and the files disagree, or if a known answer is not reproduced.

Until step 6, the deployed worker stops rather than scoring with a model it was
not built for. That is the intended behaviour.

## Model integrity

Each check fails the run with exit code 5 and a stated reason. There is no
fallback model and no default probability.

| When | Check | Code |
| --- | --- | --- |
| `docker build` | Size and SHA-256 of all four artifacts, and training-library versions | `src/updater/integrity.py`, `RUN` step in `Dockerfile.worker` |
| Every start, before unpickling | The registry version must be the pinned one; size and SHA-256 must match | `models.load_active_models` |
| After unpickling | The bundle's `model_version`, `pathogen_key`, `feature_version` and `n_features` must match | `integrity.verify_bundle` |
| Every start, before scoring | 5 medicines × 4 models recomputed through the new-medicine path, within 1e-9 of the manifest **and** of the live Supabase rows | `integrity.run_known_answers` |
| Docker `HEALTHCHECK` | `--check` runs all of the above | `Dockerfile.worker` |

Tests: `tests/test_update_worker.py` covers corrupted, missing, renamed and
unpinned artifacts, a different scikit-learn, and a drifting answer. It also
checks the worker's features against the fingerprint the pipeline stored for
every approved medicine.

## How a new medicine travels

1. **Detected.** ChEMBL's approved molecules are read in full and each structure
   is standardised. A `molecule_id` (InChIKey) that is not in Supabase's
   `molecules` is new. A record without a structure is counted and skipped;
   nothing is filled in from elsewhere.
2. **Features.** `src/updater/features.py` re-parses the standardised canonical
   SMILES and computes the Morgan fingerprint (radius 2, 1,024 bits, chirality
   off, all from `configs/`) and the descriptors, exactly as
   `src/pipeline/process.py` does for the published data. It used to fingerprint
   the in-memory standardised molecule instead, which gives different bits for
   7 of the 1,691 approved medicines. A test now holds the two paths equal.
3. **Scored.** Each of the four verified models is called through
   `src.ml.models.predict_proba`, the pipeline's own call.
4. **Published.** One transaction per medicine writes the `molecules` row, its
   FDA products in `drugs`, and four `predictions` rows. Each prediction carries
   `model_version`, `model_type`, `dataset_version`, `feature_version` and
   `predicted_at`. Predictions insert with `on conflict do nothing`, so a rerun
   adds nothing. A new medicine is never added to `bioactivity` or to a dataset:
   it is scored, never learned from.
5. **Shown.** The writes fire the `record_data_change` trigger (migration
   `web/supabase/migrations/0003_amr_data_version.sql`). That moves the
   website's data version, so the next page request misses the read cache and
   the medicine appears everywhere at once.

## Verifying it worked

```bash
docker run --rm --env-file worker.env amr-worker:latest --check
```

reports the number of published molecules and predictions. In Supabase, the run
itself is in `pipeline_runs` with `stage = 'update'`, the sources consulted are
in `data_sources`, and any per-item failures are in `pipeline_errors` with the
same `run_id`.

The website needs no change. Every write moves the data version its read cache
is keyed on, so a newly published medicine appears on the next request. Each
page records the version it was built from in
`<meta name="amr-data-version">`.
