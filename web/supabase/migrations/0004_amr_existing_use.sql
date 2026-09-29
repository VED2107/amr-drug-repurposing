-- What each approved medicine is already used for, and whether it is already
-- an antibacterial.
--
-- The website keeps existing antibacterials out of the repurposing candidates.
-- That decision is read from these tables, which the research pipeline fills
-- from public classifications (`python -m src.pipeline.classify`):
--
--   * WHO ATC codes, as ChEMBL records them for the molecule, its parent and
--     its salt and hydrate forms;
--   * FDA Established Pharmacologic Classes, from single-ingredient openFDA
--     labels;
--   * approved indications (ChEMBL, max_phase_for_ind = 4, sourced from FDA and
--     DailyMed labels), which the site shows as the medicine's existing use.
--
-- The rule is `classify()` in src/ingestion/classification.py; its version is
-- stored on every status row. The full approved library is never filtered by
-- it: a medicine that no source classifies is 'unclassified' and is kept.

-- A combination product is stored as one row per active ingredient; this keeps
-- the product's full ingredient field beside each of them.
alter table amr.drugs add column if not exists ingredients text;

create table if not exists amr.medicine_classes (
  molecule_id       text not null references amr.molecules(molecule_id),
  system            text not null,          -- 'WHO ATC' | 'FDA EPC'
  code              text not null,
  name              text,
  group_name        text,                   -- ATC level-4 description
  therapeutic_group text,                   -- ATC level-2 description
  source_ref        text,                   -- ChEMBL id or FDA application number
  retrieved_at      timestamptz not null,
  primary key (molecule_id, system, code)
);

create table if not exists amr.medicine_indications (
  molecule_id  text not null references amr.molecules(molecule_id),
  indication   text not null,
  mesh_heading text,
  source_ref   text,
  ref_url      text,
  retrieved_at timestamptz not null,
  primary key (molecule_id, indication)
);

-- One row per medicine that was looked up. No row is "not yet checked";
-- 'unclassified' is "checked, and no source classifies it".
create table if not exists amr.medicine_use_status (
  molecule_id      text primary key references amr.molecules(molecule_id),
  status           text not null
    check (status in ('antibacterial', 'other_anti_infective', 'not_anti_infective', 'unclassified')),
  -- The same decision as a three-valued flag. 'unclassified' is never 'false'.
  is_antibacterial text not null
    check (is_antibacterial in ('true', 'false', 'unclassified')),
  basis            text,
  rule_version     text not null,
  fda_label_set_id text,
  retrieved_at     timestamptz not null
);

create index if not exists medicine_use_status_status on amr.medicine_use_status (status);

-- Same exposure as every other table in this schema (see 0001), and the same
-- data-change trigger (see 0003), so the site's read cache moves when these do.
do $$
declare t text;
begin
  foreach t in array array['medicine_classes', 'medicine_indications', 'medicine_use_status']
  loop
    execute format('alter table amr.%I enable row level security', t);
    execute format('drop policy if exists %I on amr.%I', 'read_' || t, t);
    execute format(
      'create policy %I on amr.%I for select to anon, authenticated using (true)',
      'read_' || t, t);
    execute format('grant select on amr.%I to anon, authenticated', t);
    execute format('drop trigger if exists record_data_change on amr.%I', t);
    execute format(
      'create trigger record_data_change
         after insert or update or delete or truncate on amr.%I
         for each statement execute function amr.record_data_change()', t);
  end loop;
end $$;
