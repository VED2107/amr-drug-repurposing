-- A data version the website can key its read cache on.
--
-- The website caches reads so that a page does not pay a round trip to the
-- database for figures that have not moved. A cache on a timer alone cannot
-- know when they have moved: after a pipeline run or an ETL export it went on
-- serving the previous figures, each query on its own clock, and it survived a
-- restart or a redeploy with them. A page could then show a count that the
-- database no longer holds, or two pages could disagree about the same count.
--
-- This gives the database a way to say "the published data changed". Every
-- transaction that writes to a table in this schema records itself once in
-- `amr.data_changes`, in the same transaction as the write, so the record
-- becomes visible exactly when the write does — never before it (which would
-- let a reader cache old rows under the new version) and never after it.
--
-- The version is `count(*)` and `max(xact_id)` of that log. It is append-only
-- on purpose: one row per writing transaction, with its own key, so concurrent
-- writers never wait on each other for a shared counter row. Do not prune it —
-- a shorter log could reproduce an old version and revive old cache entries.
--
-- Nothing scientific is stored here and no existing row is changed.

create table if not exists amr.data_changes (
  xact_id    bigint      primary key,
  changed_at timestamptz not null default now()
);

comment on table amr.data_changes is
  'One row per transaction that wrote to the amr schema. The website keys its read cache on count(*) and max(xact_id). Append-only; do not prune.';

create or replace function amr.record_data_change()
returns trigger
language plpgsql
security definer
set search_path = amr, pg_catalog
as $$
begin
  insert into amr.data_changes (xact_id)
  values (pg_current_xact_id()::text::bigint)
  on conflict (xact_id) do nothing;
  return null;
end;
$$;

-- Statement-level, so a COPY of fifty thousand rows records one change, and
-- TRUNCATE (which fires no row triggers) is covered too.
do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'amr'
       and c.relkind in ('r', 'p')
       and c.relname <> 'data_changes'
  loop
    execute format('drop trigger if exists record_data_change on amr.%I', t.relname);
    execute format(
      'create trigger record_data_change
         after insert or update or delete or truncate on amr.%I
         for each statement execute function amr.record_data_change()',
      t.relname
    );
  end loop;
end $$;

-- Seed one row so the version is defined before the first write after this.
insert into amr.data_changes (xact_id)
values (pg_current_xact_id()::text::bigint)
on conflict (xact_id) do nothing;

-- Same exposure as every other table in this schema (see 0001).
alter table amr.data_changes enable row level security;
drop policy if exists read_data_changes on amr.data_changes;
create policy read_data_changes on amr.data_changes
  for select to anon, authenticated using (true);
grant select on amr.data_changes to anon, authenticated;
