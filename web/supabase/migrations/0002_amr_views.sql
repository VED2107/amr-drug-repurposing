-- Derived views for the AMR Research website.
--
-- Everything here is derivation, never invention: each view is a join or an
-- aggregate over rows that already exist. Keeping the derivation in SQL means
-- the rule is auditable in one place rather than scattered through React.

-- ---------------------------------------------------------------------------
-- Predictions from ACTIVE models, with the training-data disclosure attached.
-- ---------------------------------------------------------------------------
--
-- `in_training_data` is derived by asking whether this molecule carried a label
-- in the dataset the model was trained on. It is three-valued on purpose:
--
--   true   the molecule was in that dataset — the score is recall, not discovery
--   false  the dataset is known and the molecule is absent from it
--   null   the prediction records no dataset_version, so membership is unknown
--
-- `null` must not be rendered as `false`.

create or replace view amr.v_active_predictions as
select
  p.molecule_id,
  p.pathogen_key,
  p.probability,
  p.model_version,
  p.model_type,
  p.dataset_version,
  p.feature_version,
  p.predicted_at,
  case
    when p.dataset_version is null then null
    else dm.molecule_id is not null
  end                                            as in_training_data,
  dm.split                                       as training_split,
  dm.label                                       as training_label
from amr.predictions p
join amr.model_versions m
  on m.model_version = p.model_version
 and m.status = 'ACTIVE'
left join amr.dataset_members dm
  on dm.dataset_version = p.dataset_version
 and dm.molecule_id     = p.molecule_id
 and dm.pathogen_key    = p.pathogen_key;

-- ---------------------------------------------------------------------------
-- Per-pathogen resistance coverage.
-- ---------------------------------------------------------------------------
--
-- This view is the evidence behind the resistance-language limitation. The
-- fraction is null rather than zero when there are no labelled records at all,
-- because "no labels" and "no resistant labels" are different statements.

create or replace view amr.v_pathogen_coverage as
select
  pg.key,
  pg.label,
  pg.full_name,
  pg.organism,
  pg.tax_id,
  count(b.activity_id) filter (where b.label is not null)          as labelled_records,
  count(b.activity_id) filter (where b.label is not null
                                 and b.strain_specific)            as resistant_strain_records,
  case
    when count(b.activity_id) filter (where b.label is not null) = 0 then null
    else count(b.activity_id) filter (where b.label is not null and b.strain_specific)::double precision
         / count(b.activity_id) filter (where b.label is not null)
  end                                                              as resistant_strain_fraction,
  (select mv.model_version
     from amr.model_versions mv
    where mv.pathogen_key = pg.key and mv.status = 'ACTIVE'
    order by mv.training_date desc
    limit 1)                                                       as active_model_version
from amr.pathogens pg
left join amr.bioactivity b on b.pathogen_key = pg.key
group by pg.key, pg.label, pg.full_name, pg.organism, pg.tax_id;

-- ---------------------------------------------------------------------------
-- The approved library, joined to its structure.
-- ---------------------------------------------------------------------------

create or replace view amr.v_medicines as
select
  d.drug_id,
  d.molecule_id,
  d.generic_name,
  d.brand_name,
  d.approval_source,
  d.approval_status,
  d.application_no,
  d.application_type,
  d.marketing_status,
  d.dosage_form,
  d.route,
  d.approval_date,
  coalesce(d.chembl_id, m.chembl_id) as chembl_id,
  d.match_method,
  d.processing_status,
  d.prediction_status,
  m.canonical_smiles,
  m.inchikey,
  m.mw,
  m.logp,
  m.tpsa,
  m.qed,
  m.lipinski_violations,
  m.murcko_scaffold,
  m.is_valid,
  -- Whether this medicine has ever been asked about at the registry. Drives
  -- the "not yet checked" state and must stay a left join.
  (cq.molecule_id is not null)       as clinical_checked,
  cq.retrieved_at                    as clinical_checked_at,
  cq.n_results                       as clinical_n_results
from amr.drugs d
left join amr.molecules m        on m.molecule_id  = d.molecule_id
left join amr.clinical_queries cq on cq.molecule_id = d.molecule_id;

-- ---------------------------------------------------------------------------
-- Best stored pose per molecule × pathogen.
-- ---------------------------------------------------------------------------
--
-- Only successful poses are ranked. Failed rows stay in the base table so that
-- a failure reads as "not checked successfully" rather than disappearing.

create or replace view amr.v_best_docking as
select distinct on (r.molecule_id, r.pathogen_key)
  r.molecule_id,
  r.pathogen_key,
  r.target_key,
  r.run_id,
  r.pose_rank,
  r.score_kcal_mol,
  r.rmsd_lb,
  r.rmsd_ub,
  r.pose_path,
  r.status
from amr.docking_results r
where r.status = 'ok' and r.score_kcal_mol is not null
order by r.molecule_id, r.pathogen_key, r.score_kcal_mol asc;

-- ---------------------------------------------------------------------------
-- Measured-activity counts per molecule × pathogen.
-- ---------------------------------------------------------------------------

create or replace view amr.v_measured_activity as
select
  b.molecule_id,
  b.pathogen_key,
  count(*) filter (where b.label is not null)                   as labelled_records,
  count(*) filter (where b.label = 1)                           as active_records,
  count(*) filter (where b.strain_specific)                     as resistant_strain_records,
  max(b.pactivity)                                              as best_pactivity
from amr.bioactivity b
where b.molecule_id is not null
group by b.molecule_id, b.pathogen_key;

-- ---------------------------------------------------------------------------
-- Headline coverage. Every figure is a live count.
-- ---------------------------------------------------------------------------

create or replace view amr.v_coverage_summary as
select
  (select count(distinct molecule_id) from amr.drugs
    where molecule_id is not null)                              as approved_medicines,
  (select count(*) from amr.molecules where is_valid)           as valid_structures,
  (select count(distinct nct_id) from amr.clinical_trials)      as distinct_studies,
  (select count(*) from amr.clinical_trials)                    as trial_links,
  (select count(*) from amr.docking_results where status = 'ok') as stored_poses,
  (select count(*) from amr.bioactivity where label is not null) as labelled_bioactivity,
  (select count(*) from amr.v_active_predictions)               as active_predictions,
  (select count(*) from amr.model_versions where status = 'ACTIVE') as active_models,
  (select count(*) from amr.clinical_queries)                   as clinical_checked,
  (select count(distinct molecule_id) from amr.drugs
    where molecule_id is not null)                              as clinical_total,
  (select count(distinct molecule_id) from amr.docking_results
    where status = 'ok')                                        as docked_medicines;

grant select on all tables in schema amr to anon, authenticated;
