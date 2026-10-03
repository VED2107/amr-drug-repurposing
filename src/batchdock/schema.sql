-- Batch molecular docking: every library medicine against every selected target.
--
-- Lives in its own schema, `docking`, beside the published `amr` schema rather
-- than inside it, for two reasons:
--
--   * `amr` tables carry the statement trigger from migration 0003 that bumps
--     the website's data version on every write. A queue writes several times
--     per job; inside `amr` it would invalidate every cached page every few
--     seconds for the whole length of a run.
--   * The legacy `amr.docking_runs` / `amr.docking_results` tables (the earlier
--     top-candidates docking) keep their names and their rows. Nothing here
--     rewrites them.
--
-- The database is the source of truth for progress. Artifact files are
-- referenced by object key and checksum; their bytes live in object storage.
--
-- This file is applied by `python -m src.batchdock migrate` and is copied
-- verbatim to web/supabase/migrations/0005_docking_queue.sql (a test keeps the
-- two identical). Every statement is idempotent.

create schema if not exists docking;

-- ---------------------------------------------------------------------------
-- Stored files: receptors, ligands, poses, logs
-- ---------------------------------------------------------------------------
create table if not exists docking.artifacts (
  id                 bigserial primary key,
  kind               text        not null,          -- receptor_source_pdb, receptor_pdbqt, ligand_sdf, ligand_pdbqt, pose_pdbqt, vina_log
  object_key         text        not null unique,   -- path relative to the artifact root / bucket
  sha256             text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes         bigint      not null check (size_bytes > 0),
  content_type       text        not null default 'text/plain',
  remote_bucket      text,                          -- set once the bytes are in object storage
  remote_uploaded_at timestamptz,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- One reproducible docking configuration. Content-addressed: the hash is the
-- SHA-256 of the canonical JSON of every parameter that can change a score.
-- ---------------------------------------------------------------------------
create table if not exists docking.configurations (
  config_hash      text primary key check (config_hash ~ '^[0-9a-f]{64}$'),
  version_label    text             not null,
  engine           text             not null,
  engine_version   text             not null,
  exhaustiveness   integer          not null check (exhaustiveness > 0),
  num_modes        integer          not null check (num_modes > 0),
  energy_range     double precision not null check (energy_range > 0),
  seed             integer          not null,
  box_size_x       double precision not null check (box_size_x > 0),
  box_size_y       double precision not null check (box_size_y > 0),
  box_size_z       double precision not null check (box_size_z > 0),
  receptor_method  text             not null,
  ligand_method    text             not null,
  parameters       jsonb            not null,
  created_at       timestamptz      not null default now()
);

-- ---------------------------------------------------------------------------
-- Targets: the bacterial proteins, prepared once.
-- ---------------------------------------------------------------------------
create table if not exists docking.targets (
  target_id               text primary key,         -- e.g. sa_dhfr; same key as amr.targets.target_key
  pathogen_key            text             not null,
  organism                text             not null,
  protein_name            text             not null,
  gene                    text,
  uniprot_id              text,
  pdb_id                  text,
  chain                   text,
  structure_source        text,
  site_mode               text,
  site_reference          text,
  binding_site_definition text,
  center_x                double precision,
  center_y                double precision,
  center_z                double precision,
  size_x                  double precision,
  size_y                  double precision,
  size_z                  double precision,
  n_protein_atoms         integer,
  source_artifact_id      bigint references docking.artifacts(id),
  prepared_artifact_id    bigint references docking.artifacts(id),
  preparation_method      text,
  preparation_status      text not null default 'PENDING'
    check (preparation_status in ('PENDING', 'READY', 'TARGET_PREPARATION_FAILED')),
  preparation_error       text,
  selected                boolean not null default true,
  prepared_at             timestamptz,
  created_at              timestamptz not null default now(),
  -- A READY target always has a box and a receptor file. Nothing is guessed.
  check (preparation_status <> 'READY' or (
    prepared_artifact_id is not null and center_x is not null and center_y is not null
    and center_z is not null and size_x > 0 and size_y > 0 and size_z > 0))
);

-- ---------------------------------------------------------------------------
-- Ligands: one per medicine (ligand_id = amr molecule_id), plus reference
-- co-crystallised ligands used only by validation (ligand_id = 'ccd:<code>').
-- ---------------------------------------------------------------------------
create table if not exists docking.ligands (
  ligand_id           text primary key,
  molecule_id         text,                      -- amr.molecules.molecule_id for library medicines
  name                text,
  canonical_smiles    text,
  inchi               text,
  inchikey            text,
  structure_source    text not null,             -- where the structure came from, exactly
  heavy_atoms         integer,
  rotatable_bonds     integer,
  torsions            integer,                   -- active torsions in the prepared PDBQT
  sdf_artifact_id     bigint references docking.artifacts(id),
  pdbqt_artifact_id   bigint references docking.artifacts(id),
  preparation_method  text,
  preparation_status  text not null default 'PENDING'
    check (preparation_status in ('PENDING', 'READY', 'STRUCTURE_UNAVAILABLE', 'LIGAND_PREPARATION_FAILED')),
  preparation_error   text,
  prepared_at         timestamptz,
  created_at          timestamptz not null default now(),
  check (preparation_status <> 'READY' or pdbqt_artifact_id is not null)
);
create index if not exists ligands_molecule_idx on docking.ligands (molecule_id);

-- ---------------------------------------------------------------------------
-- Runs: a named batch under one configuration.
-- ---------------------------------------------------------------------------
create table if not exists docking.runs (
  run_id            text primary key,
  run_name          text        not null,
  kind              text        not null check (kind in ('validation', 'benchmark', 'full')),
  config_hash       text        not null references docking.configurations(config_hash),
  engine            text        not null,
  engine_version    text        not null,
  status            text        not null default 'RUNNING'
    check (status in ('RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED')),
  validation_passed boolean,                       -- validation runs only
  validation_report jsonb,
  total_jobs        integer,                       -- snapshots; live counts come from docking.jobs
  completed_jobs    integer,
  failed_jobs       integer,
  queued_jobs       integer,
  configuration     jsonb       not null,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs: one per (ligand, target, configuration). The unique constraint is what
-- makes a duplicate docking impossible, whichever run asks for it.
-- ---------------------------------------------------------------------------
create table if not exists docking.jobs (
  id                bigserial primary key,
  run_id            text    not null references docking.runs(run_id),
  ligand_id         text    not null references docking.ligands(ligand_id),
  target_id         text    not null references docking.targets(target_id),
  config_hash       text    not null references docking.configurations(config_hash),
  status            text    not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'STRUCTURE_UNAVAILABLE',
                      'LIGAND_PREPARATION_FAILED', 'TARGET_PREPARATION_FAILED',
                      'DOCKING_FAILED', 'CANCELLED')),
  priority          integer not null default 0,     -- lower runs first
  attempt_count     integer not null default 0,
  max_attempts      integer not null default 3 check (max_attempts > 0),
  not_before        timestamptz,                    -- retry backoff
  lease_expires_at  timestamptz,
  heartbeat_at      timestamptz,
  worker_id         text,
  started_at        timestamptz,
  completed_at      timestamptz,
  duration_seconds  double precision,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (ligand_id, target_id, config_hash),
  check (status <> 'RUNNING' or (worker_id is not null and lease_expires_at is not null))
);
create index if not exists jobs_claim_idx   on docking.jobs (priority, id) where status = 'QUEUED';
create index if not exists jobs_running_idx on docking.jobs (lease_expires_at) where status = 'RUNNING';
create index if not exists jobs_status_idx  on docking.jobs (config_hash, status);
create index if not exists jobs_run_idx     on docking.jobs (run_id, status);
create index if not exists jobs_target_idx  on docking.jobs (target_id, status);
create index if not exists jobs_done_idx    on docking.jobs (completed_at) where completed_at is not null;

-- ---------------------------------------------------------------------------
-- Results: exactly one per completed job, written in the same transaction
-- that marks the job COMPLETED. Never written for any other status.
-- ---------------------------------------------------------------------------
create table if not exists docking.results (
  id                bigserial primary key,
  job_id            bigint  not null unique references docking.jobs(id),
  ligand_id         text    not null references docking.ligands(ligand_id),
  target_id         text    not null references docking.targets(target_id),
  config_hash       text    not null references docking.configurations(config_hash),
  best_affinity     double precision not null
    check (best_affinity > -100 and best_affinity < 100),   -- also rejects NaN and infinity
  poses_count       integer not null check (poses_count > 0),
  rmsd_lower_bound  double precision,             -- largest l.b. RMSD from the best pose (pose spread)
  rmsd_upper_bound  double precision,             -- largest u.b. RMSD from the best pose
  poses             jsonb   not null,             -- [{rank, affinity, rmsd_lb, rmsd_ub}]
  pose_artifact_id  bigint  not null references docking.artifacts(id),
  log_artifact_id   bigint  not null references docking.artifacts(id),
  engine            text    not null,
  engine_version    text    not null,
  exhaustiveness    integer not null,
  num_modes         integer not null,
  energy_range      double precision not null,
  seed              integer not null,
  cpu               integer not null,
  center_x          double precision not null,
  center_y          double precision not null,
  center_z          double precision not null,
  size_x            double precision not null,
  size_y            double precision not null,
  size_z            double precision not null,
  receptor_sha256   text    not null,
  ligand_sha256     text    not null,
  command           text    not null,             -- the exact engine invocation
  worker_id         text    not null,
  duration_seconds  double precision not null,
  created_at        timestamptz not null default now(),
  unique (ligand_id, target_id, config_hash)
);
create index if not exists results_target_affinity_idx on docking.results (target_id, best_affinity);
create index if not exists results_ligand_idx on docking.results (ligand_id);

-- ---------------------------------------------------------------------------
-- Workers: liveness and throughput of every worker process, on any machine.
-- ---------------------------------------------------------------------------
create table if not exists docking.workers (
  worker_id      text primary key,
  hostname       text        not null,
  engine         text        not null,
  engine_version text        not null,
  concurrency    integer     not null,
  cpu_per_job    integer     not null,
  cpu_count      integer,
  status         text        not null default 'RUNNING' check (status in ('RUNNING', 'STOPPING', 'STOPPED')),
  jobs_completed integer     not null default 0,
  jobs_failed    integer     not null default 0,
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now()
);
-- Where a worker runs, for the dashboard: 'local' (Docker on a workstation),
-- 'kaggle' (a Kaggle notebook session) or any other label. Operational only.
alter table docking.workers add column if not exists kind text not null default 'local';
alter table docking.workers add column if not exists session_label text;

-- Not exposed to the public API roles. The website reads it server-side.
alter table docking.artifacts      enable row level security;
alter table docking.configurations enable row level security;
alter table docking.targets        enable row level security;
alter table docking.ligands        enable row level security;
alter table docking.runs           enable row level security;
alter table docking.jobs           enable row level security;
alter table docking.results        enable row level security;
alter table docking.workers        enable row level security;
