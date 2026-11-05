-- Change Orders: a line can be a place instead of a Lot.
--
-- Some extras are not for a Lot: the Sales Office, the Restroom, the Design Center of a Job. The Excel
-- sheets keep them as rows with no Lot, so a line must be allowed to say "where" in words.
--
-- A line is now one of two things:
--   a Lot line        lot_id, phase_id and the copied Phase, Lot and Plan labels are all set, no location.
--   a location line   only the location text is set (up to 100 characters); no Lot, Phase or Plan.
--
-- A Lot is still in a Change Order only once. The line gets an id of its own because a location line
-- has no Lot to be identified by, and the rule "once per Lot" becomes a unique constraint instead of
-- the primary key (a unique constraint lets many location lines share a Change Order).
--
-- The Amount of a line is what is billed, net of any discount the builder takes (for example OCIP).
-- Nothing about Purchase Orders changes here.

begin;

alter table valtrim.change_order_lines drop constraint change_order_lines_pkey;

alter table valtrim.change_order_lines
  add column id bigint generated always as identity;
alter table valtrim.change_order_lines add primary key (id);

alter table valtrim.change_order_lines
  add constraint change_order_lines_one_per_lot unique (change_order_id, lot_id);

alter table valtrim.change_order_lines
  alter column lot_id drop not null,
  alter column phase_id drop not null,
  alter column phase_code drop not null,
  alter column lot_number drop not null,
  alter column plan_code drop not null,
  alter column plan_name drop not null,
  add column location varchar(100)
    check (location is null or btrim(location) <> '');

alter table valtrim.change_order_lines
  add constraint change_order_lines_lot_or_location check (
    (
      lot_id is not null
      and phase_id is not null
      and phase_code is not null
      and lot_number is not null
      and plan_code is not null
      and plan_name is not null
      and location is null
    )
    or (
      location is not null
      and lot_id is null
      and phase_id is null
      and phase_code is null
      and building is null
      and lot_number is null
      and plan_code is null
      and plan_name is null
    )
  );

revoke all on sequence valtrim.change_order_lines_id_seq from public, anon, authenticated;

-- Replaces every line of the CO with `p_lines`, an array of
--   { lot_id, scope_of_work, amount, po_number? }   a Lot line, or
--   { location, scope_of_work, amount, po_number? } a location line,
-- in the order they should be shown. Each item has a lot_id or a location, never both.
create or replace function private.replace_change_order_lines(
  p_change_order_id bigint,
  p_job_id bigint,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_lots integer;
  v_unique_lots integer;
  v_found integer;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'The lines must be a JSON array' using errcode = '23514';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count not between 1 and 5000 then
    raise exception 'Add between 1 and 5000 lines' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) item
    where jsonb_typeof(item) <> 'object'
       or (
         (
           (
             jsonb_typeof(item->'lot_id') = 'number'
             and item->>'lot_id' ~ '^[1-9][0-9]*$'
             and coalesce(jsonb_typeof(item->'location'), 'null') = 'null'
           )
           or (
             jsonb_typeof(item->'location') = 'string'
             and char_length(btrim(item->>'location')) between 1 and 100
             and coalesce(jsonb_typeof(item->'lot_id'), 'null') = 'null'
           )
         ) is not true
       )
       or jsonb_typeof(item->'scope_of_work') is distinct from 'string'
       or char_length(btrim(item->>'scope_of_work')) not between 1 and 1000
       or jsonb_typeof(item->'amount') is distinct from 'number'
       or item->>'amount' !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
       or (
         case
           when item->>'amount' ~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
             then (item->>'amount')::numeric = 0
           else true
         end
       )
       or (
         item ? 'po_number'
         and (
           jsonb_typeof(item->'po_number') not in ('string', 'null')
           or char_length(btrim(coalesce(item->>'po_number', ''))) > 60
         )
       )
  ) then
    raise exception
      'Every line needs a Lot or a location, a Scope of Work up to 1000 characters and an Amount other than zero with at most 2 decimals'
      using errcode = '23514';
  end if;

  select count(*), count(distinct (item->>'lot_id')::bigint)
  into v_lots, v_unique_lots
  from jsonb_array_elements(p_lines) item
  where jsonb_typeof(item->'lot_id') = 'number';
  if v_unique_lots <> v_lots then
    raise exception 'A Lot can be in a Change Order only once' using errcode = '23505';
  end if;

  select count(*)
  into v_found
  from jsonb_array_elements(p_lines) item
  join valtrim.lots lot on lot.id = (item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  where jsonb_typeof(item->'lot_id') = 'number'
    and lot.job_id = p_job_id
    and phase.job_id = p_job_id
    and phase.is_active;
  if v_found <> v_lots then
    raise exception 'Every Lot must belong to an active Phase of the Job'
      using errcode = '23503';
  end if;

  delete from valtrim.change_order_lines
  where change_order_id = p_change_order_id;

  insert into valtrim.change_order_lines (
    change_order_id, lot_id, job_id, phase_id, line_number,
    phase_code, building, lot_number, plan_code, plan_name, location,
    scope_of_work, amount, po_number
  )
  select
    p_change_order_id,
    lot.id,
    lot.job_id,
    lot.phase_id,
    requested.ord::integer,
    phase.code,
    phase.building,
    lot.lot_number,
    plan.code,
    plan.name,
    null::varchar,
    btrim(requested.item->>'scope_of_work'),
    (requested.item->>'amount')::numeric(14,2),
    nullif(btrim(coalesce(requested.item->>'po_number', '')), '')
  from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
  join valtrim.lots lot on lot.id = (requested.item->>'lot_id')::bigint
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plans plan on plan.id = lot.plan_id
  where jsonb_typeof(requested.item->'lot_id') = 'number'
  union all
  select
    p_change_order_id,
    null::bigint,
    p_job_id,
    null::bigint,
    requested.ord::integer,
    null::varchar,
    null::varchar,
    null::varchar,
    null::varchar,
    null::varchar,
    btrim(requested.item->>'location'),
    btrim(requested.item->>'scope_of_work'),
    (requested.item->>'amount')::numeric(14,2),
    nullif(btrim(coalesce(requested.item->>'po_number', '')), '')
  from jsonb_array_elements(p_lines) with ordinality as requested(item, ord)
  where jsonb_typeof(requested.item->'lot_id') is distinct from 'number';
end;
$$;

comment on table valtrim.change_order_lines is
  'One line per Lot of a Change Order, or a line for a place with no Lot (Sales Office, Restroom). Each has its own Scope of Work, Amount (negative for a credit, net of any builder discount) and optional PO number. Lot labels are copied when saved.';
comment on column valtrim.change_order_lines.location is
  'Where a line with no Lot applies, in words. Empty on a Lot line; a location line has no Lot, Phase or Plan.';

notify pgrst, 'reload schema';
commit;
