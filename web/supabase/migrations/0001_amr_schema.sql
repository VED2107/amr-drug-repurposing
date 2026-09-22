-- AMR Research production schema.
--
-- This mirrors the scientific schema in `data/amr.sqlite` (see
-- `docs/ARCHITECTURE.md`). Column names are preserved so that any value on the
-- website can be traced back to the column it came from in the research system.
--
-- Nothing here derives, rounds or reinterprets a scientific value. The ETL in
-- `scripts/export_to_postgres.py` copies rows across unchanged; the only
-- additions are indexes and row-level security.

create schema if not exists amr;

-- ---------------------------------------------------------------------------
-- Reference
-- ---------------------------------------------------------------------------

create table amr.pathogens (
  key        text primary key,
  label      text not null,
  full_name  text not null,
  organism   text not null,
  tax_id     integer
);

create table amr.targets (
  target_key      text primary key,
  pathogen_key    text not null references amr.pathogens(key),
  name            text not null,
  gene            text,
  pdb_id          text not null,
  chain           text not null,
  uniprot         text,
  site_mode       text not null,
  site_reference  text,
  box_center_x    double precision,
  box_center_y    double precision,
  box_center_z    double precision,
  box_size_x      double precision,
  box_size_y      double precision,
  box_size_z      double precision,
  receptor_path   text,
  structure_url   text,
  status          text not null default 'pending',
  error           text,
  selection_notes text,
  prepared_at     timestamptz
);

-- ---------------------------------------------------------------------------
-- Chemistry
-- ---------------------------------------------------------------------------

-- molecule_id is the InChIKey: identity is fixed on structure, not on name.
create table amr.molecules (
  molecule_id         text primary key,
  chembl_id           text,
  pref_name           text,
  input_smiles        text,
  canonical_smiles    text,
  inchi               text,
  inchikey            text,
  mw                  double precision,
  logp                double precision,
  tpsa                double precision,
  hbd                 integer,
  hba                 integer,
  rotatable_bonds     integer,
  aromatic_rings      integer,
  heavy_atoms         integer,
  fraction_csp3       double precision,
  qed                 double precision,
  lipinski_violations integer,
  murcko_scaffold     text,
  feature_version     text,
  is_valid            boolean not null default false,
  validation_error    text,
  created_at          timestamptz not null,
  updated_at          timestamptz not null
);

-- The fingerprint BLOB is deliberately not carried over: it is a model input,
-- not something the website displays, and it would bloat the row for no reader.

create index on amr.molecules (chembl_id);
create index on amr.molecules (inchikey);
create index on amr.molecules (is_valid);
create index on amr.molecules (murcko_scaffold);

create table amr.drugs (
  drug_id           text primary key,
  molecule_id       text references amr.molecules(molecule_id),
  generic_name      text not null,
  brand_name        text,
  approval_source   text not null,
  approval_status   text,
  application_no    text,
  application_type  text,
  marketing_status  text,
  dosage_form       text,
  route             text,
  approval_date     text,
  chembl_id         text,
  match_method      text,
  first_seen_at     timestamptz not null,
  processing_status text not null default 'pending',
  prediction_status text not null default 'pending'
);

create index on amr.drugs (molecule_id);
create index on amr.drugs (generic_name);
create index on amr.drugs (brand_name);

-- ---------------------------------------------------------------------------
-- Measured activity
-- ---------------------------------------------------------------------------

create table amr.bioactivity (
  activity_id        bigint primary key,
  source_activity_id text,
  source             text not null,
  molecule_id        text references amr.molecules(molecule_id),
  chembl_id          text,
  pathogen_key       text not null references amr.pathogens(key),
  organism           text,
  target_chembl_id   text,
  target_pref_name   text,
  assay_chembl_id    text,
  assay_description  text,
  assay_type         text,
  activity_type      text,
  activity_value     double precision,
  activity_units     text,
  activity_relation  text,
  pchembl_value      double precision,
  pactivity          double precision,
  pactivity_method   text,
  label              integer,
  label_reason       text,
  -- Whether the measurement names a resistant strain. This is the column
  -- behind the resistance-coverage limitation and must not be dropped.
  strain_specific    boolean not null default false,
  document_chembl_id text,
  document_year      integer,
  created_at         timestamptz not null,
  unique (source, source_activity_id)
);

create index on amr.bioactivity (molecule_id, pathogen_key);
create index on amr.bioactivity (pathogen_key) where label is not null;
create index on amr.bioactivity (pathogen_key) where strain_specific;

-- ---------------------------------------------------------------------------
-- Datasets and models
-- ---------------------------------------------------------------------------

create table amr.dataset_versions (
  dataset_version text primary key,
  created_at      timestamptz not null,
  n_records       integer,
  n_compounds     integer,
  n_pathogens     integer,
  labeling_json   jsonb,
  quality_json    jsonb,
  config_hash     text,
  artifact_path   text,
  notes           text
);

-- Membership is what makes the training-data disclosure possible: it records
-- which molecules the model actually saw, and in which split.
create table amr.dataset_members (
  dataset_version text not null references amr.dataset_versions(dataset_version),
  molecule_id     text not null,
  pathogen_key    text not null,
  label           integer not null,
  pactivity       double precision,
  n_measurements  integer,
  split           text,
  scaffold        text,
  primary key (dataset_version, molecule_id, pathogen_key)
);

create index on amr.dataset_members (molecule_id, pathogen_key);

create table amr.model_versions (
  model_version     text primary key,
  pathogen_key      text not null references amr.pathogens(key),
  model_type        text not null,
  is_baseline       boolean not null default false,
  dataset_version   text not null,
  feature_version   text not null,
  training_date     timestamptz not null,
  validation_method text,
  split_method      text,
  random_seed       integer,
  n_train           integer,
  n_validation      integer,
  n_test            integer,
  metrics_json      jsonb,
  cv_metrics_json   jsonb,
  -- text, not jsonb, and deliberately so. scikit-learn's roc_curve returns
  -- Infinity as its first threshold (the point above which nothing is
  -- classified positive). That is a real value, but it is not valid JSON, and
  -- jsonb would reject the row. Rewriting Infinity to null would be altering a
  -- scientific result to fit a column type, so the column type gives way
  -- instead. Consumers parse this with a JSON5-tolerant reader.
  curves_json       text,
  selection_reason  text,
  artifact_path     text,
  status            text not null default 'CANDIDATE',
  library_versions  jsonb,
  created_at        timestamptz not null
);

create index on amr.model_versions (pathogen_key, status);

create table amr.model_benchmarks (
  id               bigint primary key,
  benchmark_run_id text not null,
  pathogen_key     text not null,
  model_type       text not null,
  model_version    text,
  dataset_version  text not null,
  is_baseline      boolean not null default false,
  selected         boolean not null default false,
  metrics_json     jsonb not null,
  cv_metrics_json  jsonb,
  created_at       timestamptz not null
);

create index on amr.model_benchmarks (pathogen_key, benchmark_run_id);

-- ---------------------------------------------------------------------------
-- Predictions
-- ---------------------------------------------------------------------------

-- probability is stored as double precision and is never rounded here.
-- Rounding, if any, happens at the point of display and carries its label.
create table amr.predictions (
  id              bigint primary key,
  molecule_id     text not null references amr.molecules(molecule_id),
  pathogen_key    text not null references amr.pathogens(key),
  probability     double precision not null,
  model_version   text not null references amr.model_versions(model_version),
  model_type      text,
  dataset_version text,
  feature_version text,
  predicted_at    timestamptz not null,
  unique (molecule_id, pathogen_key, model_version)
);

create index on amr.predictions (pathogen_key, probability desc);
create index on amr.predictions (molecule_id);

-- ---------------------------------------------------------------------------
-- Docking
-- ---------------------------------------------------------------------------

create table amr.docking_runs (
  run_id         text primary key,
  target_key     text not null references amr.targets(target_key),
  pathogen_key   text not null,
  engine         text not null,
  engine_version text,
  exhaustiveness integer,
  num_modes      integer,
  energy_range   double precision,
  random_seed    integer,
  box_center_x   double precision,
  box_center_y   double precision,
  box_center_z   double precision,
  box_size_x     double precision,
  box_size_y     double precision,
  box_size_z     double precision,
  receptor_pdbqt text,
  n_ligands      integer,
  n_succeeded    integer,
  n_failed       integer,
  started_at     timestamptz not null,
  finished_at    timestamptz,
  status         text not null,
  error          text
);

create table amr.docking_results (
  id             bigint primary key,
  run_id         text not null references amr.docking_runs(run_id),
  molecule_id    text not null references amr.molecules(molecule_id),
  target_key     text not null,
  pathogen_key   text not null,
  pose_rank      integer not null,
  score_kcal_mol double precision,
  rmsd_lb        double precision,
  rmsd_ub        double precision,
  pose_path      text,
  -- Failures are kept. A failed docking run is "not yet checked", not "no effect".
  status         text not null,
  error          text,
  created_at     timestamptz not null,
  unique (run_id, molecule_id, pose_rank)
);

create index on amr.docking_results (molecule_id, score_kcal_mol);
create index on amr.docking_results (pathogen_key, score_kcal_mol);

-- ---------------------------------------------------------------------------
-- Clinical
-- ---------------------------------------------------------------------------

-- One row per medicine that has actually been queried against the registry.
-- The absence of a row here is what makes "not yet checked" distinguishable
-- from "no evidence found", so this table must never be back-filled.
create table amr.clinical_queries (
  molecule_id  text primary key references amr.molecules(molecule_id),
  query_term   text not null,
  n_results    integer not null,
  n_amr        integer not null,
  status       text not null,
  error        text,
  retrieved_at timestamptz not null
);

create table amr.clinical_trials (
  id              bigint primary key,
  nct_id          text not null,
  molecule_id     text references amr.molecules(molecule_id),
  query_term      text not null,
  brief_title     text,
  conditions      text,
  interventions   text,
  phase           text,
  overall_status  text,
  study_type      text,
  start_date      text,
  completion_date text,
  enrollment      integer,
  url             text,
  amr_related     boolean not null default false,
  matched_keywords text,
  retrieved_at    timestamptz not null,
  unique (nct_id, molecule_id)
);

create index on amr.clinical_trials (molecule_id);
create index on amr.clinical_trials (nct_id);

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

create table amr.pipeline_runs (
  run_id            text primary key,
  stage             text not null,
  started_at        timestamptz not null,
  finished_at       timestamptz,
  duration_seconds  double precision,
  status            text not null,
  records_processed integer not null default 0,
  records_new       integer not null default 0,
  records_skipped   integer not null default 0,
  error_count       integer not null default 0,
  params_json       jsonb,
  message           text
);

create index on amr.pipeline_runs (started_at desc);

create table amr.pipeline_errors (
  id         bigint primary key,
  run_id     text not null references amr.pipeline_runs(run_id),
  stage      text not null,
  subject    text,
  error_type text,
  message    text,
  created_at timestamptz not null
);

create table amr.data_sources (
  id             bigint primary key,
  name           text not null,
  url            text,
  source_version text,
  retrieved_at   timestamptz not null,
  record_count   integer,
  notes          text
);

create table amr.schema_info (
  key   text primary key,
  value text not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
--
-- This is published research output: every table is world-readable, and no
-- table is writable through the anon or authenticated roles. Writes happen
-- only through the ETL, which connects with the service role and bypasses RLS.
-- There is no user-supplied data anywhere in this schema, so there is nothing
-- to scope per-user.

do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'amr'
  loop
    execute format('alter table amr.%I enable row level security', t.tablename);
    execute format(
      'create policy %I on amr.%I for select to anon, authenticated using (true)',
      'read_' || t.tablename, t.tablename
    );
  end loop;
end $$;

grant usage on schema amr to anon, authenticated;
grant select on all tables in schema amr to anon, authenticated;
alter default privileges in schema amr grant select on tables to anon, authenticated;
