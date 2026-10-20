-- Phase 54: Payment Schedule templates.
--
-- A PAYMENT_SCHEDULE (or PURCHASE_ORDER) Job document can be analyzed and
-- confirmed as the Payment Schedule of a Job. The builder's PDF already holds
-- the table of Lots and draws; the system only locates every (Lot, draw) amount
-- on the page, so a Package can later highlight what it bills. This phase
-- stores the detected cells and the user-confirmed set of cells. Highlighting
-- the PDF comes later.
--
-- One Job can hold several confirmed templates: builders send one schedule per
-- Phase, and a Package picks the one that covers its Lots.
--
-- Writes follow the Job document model: browsers never write the table. The
-- analyze Edge Function writes analysis results as service_role after checking
-- the caller's role, and confirmation goes through a role-checked RPC.
-- Amounts are contract data: the full extracted text is never stored, only the
-- cells (Lot, draw, amount, position) and a short list of validation issues.

begin;

create table valtrim.payment_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the PDF deletes its template (the confirmed cells included).
  job_document_id uuid not null unique
    references valtrim.job_documents(id) on delete cascade,
  -- Denormalized for Job lookups. A trigger derives it from the document so it
  -- can never disagree.
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  -- matrix: one row per Lot, one column per draw.
  -- line_items: one row per Lot and draw (a Purchase Order style table).
  layout text check (layout in ('matrix', 'line_items')),
  detection_method text check (detection_method in ('text_layer')),
  page_count integer check (page_count between 1 and 100),
  -- [{ page, width, height, rotation }] in PDF points, one entry per page.
  page_sizes jsonb check (
    case
      when page_sizes is null then true
      when jsonb_typeof(page_sizes) = 'array'
        then jsonb_array_length(page_sizes) = page_count
      else false
    end
  ),
  -- Suggestions only, same cell shape as mapping.cells.
  detected_cells jsonb not null default '[]'::jsonb
    check (jsonb_typeof(detected_cells) = 'array'),
  -- { draws: [{ draw, name, costCode }],
  --   issues: [{ code, message, page?, lot?, draw? }],
  --   expectedTotal, foundTotal } - what the review screen shows.
  analysis jsonb not null default '{}'::jsonb
    check (jsonb_typeof(analysis) = 'object'),
  -- User-confirmed cells, validated by
  -- private.validate_payment_schedule_mapping. null until confirmed.
  mapping jsonb check (mapping is null or jsonb_typeof(mapping) = 'object'),
  status text not null default 'analyzing'
    check (status in ('analyzing', 'needs_review', 'confirmed', 'failed')),
  error text check (error is null or char_length(error) <= 1000),
  requested_by uuid not null references valtrim.app_users(id) on delete restrict,
  confirmed_by uuid references valtrim.app_users(id) on delete restrict,
  confirmed_at timestamptz,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_schedule_templates_analyzed_check check (
    status not in ('needs_review', 'confirmed')
    or (
      analyzed_at is not null
      and layout is not null
      and detection_method is not null
      and page_count is not null
      and page_sizes is not null
    )
  ),
  constraint payment_schedule_templates_confirmed_check check (
    status <> 'confirmed'
    or (
      mapping is not null
      and confirmed_by is not null
      and confirmed_at is not null
    )
  ),
  constraint payment_schedule_templates_failed_check check (
    status <> 'failed' or error is not null
  )
);

create index payment_schedule_templates_job_status_idx
  on valtrim.payment_schedule_templates (job_id, status);

create index payment_schedule_templates_requested_by_idx
  on valtrim.payment_schedule_templates (requested_by);

create index payment_schedule_templates_confirmed_by_idx
  on valtrim.payment_schedule_templates (confirmed_by)
  where confirmed_by is not null;

create function private.sync_payment_schedule_template_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document valtrim.job_documents%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.job_document_id is distinct from old.job_document_id then
    raise exception 'A Payment Schedule template cannot move to another document'
      using errcode = '23514';
  end if;

  select document.*
    into v_document
  from valtrim.job_documents document
  where document.id = new.job_document_id;

  if not found
     or v_document.document_type not in ('PAYMENT_SCHEDULE', 'PURCHASE_ORDER') then
    raise exception
      'Payment Schedule templates require a PAYMENT_SCHEDULE or PURCHASE_ORDER Job document'
      using errcode = '23514';
  end if;

  new.job_id := v_document.job_id;
  return new;
end;
$$;

create trigger payment_schedule_templates_sync_document
before insert or update on valtrim.payment_schedule_templates
for each row execute function private.sync_payment_schedule_template_document();

create trigger payment_schedule_templates_set_updated_at
before update on valtrim.payment_schedule_templates
for each row execute function valtrim.set_updated_at();

alter table valtrim.payment_schedule_templates enable row level security;

revoke all on valtrim.payment_schedule_templates from public, anon, authenticated;
grant select on valtrim.payment_schedule_templates to authenticated;
grant select, insert, update, delete
  on valtrim.payment_schedule_templates to service_role;

create policy payment_schedule_templates_select
on valtrim.payment_schedule_templates for select to authenticated
using ((select private.is_active_user()));

-- Mapping shape (version 1):
--   { "version": 1,
--     "layout": "matrix",
--     "cells": [
--       { "phase": "003",              -- as printed; null when the PDF has none
--         "lot": "0014",               -- as printed
--         "draw": 2,                   -- 1 to 5, the Billing Setup draw number
--         "amount": 1446.78,
--         "page": 1,
--         "rect": { "x": 0.1, "y": 0.2, "w": 0.05, "h": 0.01 } } ] }
-- Rect coordinates are normalized 0-1, origin at the top-left of the page as
-- displayed (after the page /Rotate), the same convention as Release templates.
-- A (phase, lot, draw) combination can appear only once, so a Package never
-- finds two cells for the same bill.
create function private.validate_payment_schedule_mapping(
  p_mapping jsonb,
  p_page_count integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_cell jsonb;
  v_rect jsonb;
  v_key text;
  v_page numeric;
  v_draw numeric;
  v_amount numeric;
  v_x numeric;
  v_y numeric;
  v_w numeric;
  v_h numeric;
  v_count integer;
  v_distinct integer;
begin
  if p_mapping is null
     or jsonb_typeof(p_mapping) <> 'object'
     or p_mapping -> 'version' is distinct from to_jsonb(1)
     or jsonb_typeof(p_mapping -> 'layout') is distinct from 'string'
     or (p_mapping ->> 'layout') not in ('matrix', 'line_items')
     or jsonb_typeof(p_mapping -> 'cells') is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_mapping) key
       where key not in ('version', 'layout', 'cells')
     ) then
    raise exception
      'The mapping must be a version 1 object with a layout and a cells list'
      using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_mapping -> 'cells');
  if v_count not between 1 and 5000 then
    raise exception 'Map between 1 and 5000 cells'
      using errcode = '23514';
  end if;

  for v_cell in
    select item.value from jsonb_array_elements(p_mapping -> 'cells') item
  loop
    if jsonb_typeof(v_cell) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_cell) key
         where key not in ('phase', 'lot', 'draw', 'amount', 'page', 'rect')
       ) then
      raise exception 'Each cell must be an object with known properties'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'lot') is distinct from 'string'
       or btrim(v_cell ->> 'lot') <> (v_cell ->> 'lot')
       or char_length(v_cell ->> 'lot') not between 1 and 40 then
      raise exception 'Each cell needs a Lot of 1 to 40 characters'
        using errcode = '23514';
    end if;

    if v_cell ? 'phase'
       and jsonb_typeof(v_cell -> 'phase') <> 'null'
       and (
         jsonb_typeof(v_cell -> 'phase') <> 'string'
         or btrim(v_cell ->> 'phase') <> (v_cell ->> 'phase')
         or char_length(v_cell ->> 'phase') not between 1 and 40
       ) then
      raise exception 'A cell Phase must be empty or 1 to 40 characters'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'draw') is distinct from 'number' then
      raise exception 'Each cell needs a draw number from 1 to 5'
        using errcode = '23514';
    end if;
    v_draw := (v_cell ->> 'draw')::numeric;
    if v_draw <> trunc(v_draw) or v_draw not between 1 and 5 then
      raise exception 'Each cell needs a draw number from 1 to 5'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'amount') is distinct from 'number' then
      raise exception 'Each cell needs an amount with at most two decimals'
        using errcode = '23514';
    end if;
    v_amount := (v_cell ->> 'amount')::numeric;
    if v_amount < 0
       or v_amount > 9999999999.99
       or v_amount <> round(v_amount, 2) then
      raise exception 'Each cell needs an amount with at most two decimals'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_cell -> 'page') is distinct from 'number' then
      raise exception 'The cell page is outside the document'
        using errcode = '23514';
    end if;
    v_page := (v_cell ->> 'page')::numeric;
    if v_page <> trunc(v_page)
       or v_page < 1
       or v_page > coalesce(p_page_count, 0) then
      raise exception 'The cell page is outside the document'
        using errcode = '23514';
    end if;

    v_rect := v_cell -> 'rect';
    if jsonb_typeof(v_rect) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_rect) key
         where key not in ('x', 'y', 'w', 'h')
       ) then
      raise exception 'Each cell needs a rectangle with x, y, w and h'
        using errcode = '23514';
    end if;

    foreach v_key in array array['x', 'y', 'w', 'h']
    loop
      if jsonb_typeof(v_rect -> v_key) is distinct from 'number' then
        raise exception 'Each cell needs a rectangle with x, y, w and h'
          using errcode = '23514';
      end if;
    end loop;

    v_x := (v_rect ->> 'x')::numeric;
    v_y := (v_rect ->> 'y')::numeric;
    v_w := (v_rect ->> 'w')::numeric;
    v_h := (v_rect ->> 'h')::numeric;

    if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1
       or v_w <= 0 or v_h <= 0
       or v_x + v_w > 1.000001 or v_y + v_h > 1.000001 then
      raise exception 'The cell rectangle must stay inside the page'
        using errcode = '23514';
    end if;
  end loop;

  select count(*)
    into v_distinct
  from (
    select distinct
      coalesce(cell.value ->> 'phase', ''),
      cell.value ->> 'lot',
      cell.value ->> 'draw'
    from jsonb_array_elements(p_mapping -> 'cells') cell
  ) distinct_cells;

  if v_distinct <> v_count then
    raise exception 'Each Phase, Lot and draw can appear only once'
      using errcode = '23514';
  end if;
end;
$$;

create function private.confirm_payment_schedule_template(
  p_template_id uuid,
  p_mapping jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_template valtrim.payment_schedule_templates%rowtype;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to confirm Payment Schedule templates'
      using errcode = '42501';
  end if;

  select template.*
    into v_template
  from valtrim.payment_schedule_templates template
  where template.id = p_template_id
  for update;

  if not found then
    raise exception 'The Payment Schedule template is no longer available'
      using errcode = 'P0002';
  end if;

  if v_template.status not in ('needs_review', 'confirmed') then
    raise exception 'Only an analyzed Payment Schedule template can be confirmed'
      using errcode = '55000';
  end if;

  perform private.validate_payment_schedule_mapping(
    p_mapping,
    v_template.page_count
  );

  update valtrim.payment_schedule_templates template
  set layout = p_mapping ->> 'layout',
      mapping = p_mapping,
      status = 'confirmed',
      error = null,
      confirmed_by = v_actor_id,
      confirmed_at = now()
  where template.id = v_template.id;

  return v_template.id;
end;
$$;

create function valtrim.confirm_payment_schedule_template(
  p_template_id uuid,
  p_mapping jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.confirm_payment_schedule_template(p_template_id, p_mapping);
$$;

revoke execute on function private.validate_payment_schedule_mapping(jsonb, integer)
  from public, anon, authenticated;
revoke execute on function private.confirm_payment_schedule_template(uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function valtrim.confirm_payment_schedule_template(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function private.validate_payment_schedule_mapping(jsonb, integer)
  to authenticated, service_role;
grant execute on function private.confirm_payment_schedule_template(uuid, jsonb)
  to authenticated, service_role;
grant execute on function valtrim.confirm_payment_schedule_template(uuid, jsonb)
  to authenticated, service_role;

comment on table valtrim.payment_schedule_templates is
  'Analysis and confirmed cells (Lot, draw, amount, position) of a PAYMENT_SCHEDULE or PURCHASE_ORDER Job document. Never stores the extracted text.';
comment on column valtrim.payment_schedule_templates.mapping is
  'Confirmed cells, version 1. Rect coordinates are normalized 0-1 with the origin at the top-left of the page as displayed (after /Rotate).';
comment on column valtrim.payment_schedule_templates.detected_cells is
  'Unconfirmed suggestions only. The confirmed mapping is the source of truth.';
comment on function valtrim.confirm_payment_schedule_template(uuid, jsonb) is
  'Validates and confirms the cells of a Payment Schedule template. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on policy payment_schedule_templates_select on valtrim.payment_schedule_templates is
  'Active authenticated users can read Payment Schedule template metadata; writes go through the analyze Edge Function and the confirm RPC.';

notify pgrst, 'reload schema';

commit;
