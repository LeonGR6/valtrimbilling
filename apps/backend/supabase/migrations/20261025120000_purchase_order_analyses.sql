-- Purchase Order (options) analysis.
--
-- A PURCHASE_ORDER Job document is a builder's work order for the options of one
-- Lot. The analyze Edge Function reads the PDF and stores one row per option line
-- it prints, already matched with the Job's Lot, Phase and Plan. Comparing those
-- lines with the options the system holds is done live by compare_purchase_orders:
-- prices change, so a comparison is never stored.
--
-- Everything here only informs. Nothing blocks a Package, and nothing changes the
-- Job's options or prices (importing options and adopting a PO price come later,
-- as explicit actions).
--
-- Writes follow the Job document model: browsers never write these tables. The
-- analyze Edge Function writes as service_role after checking the caller's role,
-- and replaces the lines of a document in one transaction through
-- save_purchase_order_analysis. The PDF's text is never stored.

begin;

-- Option codes ---------------------------------------------------------------

-- "2FIN-5006", "2fin 5006" and "2FIN5006" are the same code. Mirrors
-- normalizeOptionCode in the Edge Function code for the characters a code uses.
create function private.option_code_key(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

revoke all on function private.option_code_key(text) from public, anon;
grant execute on function private.option_code_key(text)
  to authenticated, service_role;

-- One analysis per document -----------------------------------------------------

create table valtrim.purchase_order_analyses (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the PDF deletes its analysis and its lines.
  job_document_id uuid not null unique
    references valtrim.job_documents(id) on delete cascade,
  -- Denormalized for Job lookups. A trigger derives it from the document so it
  -- can never disagree.
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  parser text check (parser in ('olson')),
  page_count integer check (page_count between 1 and 100),
  -- [{ code, message, page?, workOrderNo?, referenceNo? }]: what did not add up
  -- while reading the PDF. Short messages only.
  issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(issues) = 'array'),
  -- not_option_po: the PDF is not a Purchase Order of options (or its layout is
  -- not supported yet). It is a result, not an error.
  status text not null default 'analyzing'
    check (status in ('analyzing', 'analyzed', 'failed', 'not_option_po')),
  error text check (error is null or char_length(error) <= 1000),
  requested_by uuid not null references valtrim.app_users(id) on delete restrict,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, job_id),
  constraint purchase_order_analyses_analyzed_check check (
    status <> 'analyzed'
    or (analyzed_at is not null and parser is not null and page_count is not null)
  ),
  constraint purchase_order_analyses_failed_check check (
    status <> 'failed' or error is not null
  )
);

create index purchase_order_analyses_job_status_idx
  on valtrim.purchase_order_analyses (job_id, status);

create index purchase_order_analyses_requested_by_idx
  on valtrim.purchase_order_analyses (requested_by);

create function private.sync_purchase_order_analysis_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document valtrim.job_documents%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.job_document_id is distinct from old.job_document_id then
    raise exception 'A Purchase Order analysis cannot move to another document'
      using errcode = '23514';
  end if;

  select document.*
    into v_document
  from valtrim.job_documents document
  where document.id = new.job_document_id;

  if not found or v_document.document_type <> 'PURCHASE_ORDER' then
    raise exception
      'Purchase Order analyses require a PURCHASE_ORDER Job document'
      using errcode = '23514';
  end if;

  new.job_id := v_document.job_id;
  return new;
end;
$$;

create trigger purchase_order_analyses_sync_document
before insert or update on valtrim.purchase_order_analyses
for each row execute function private.sync_purchase_order_analysis_document();

create trigger purchase_order_analyses_set_updated_at
before update on valtrim.purchase_order_analyses
for each row execute function valtrim.set_updated_at();

-- One row per option line ---------------------------------------------------------

create table valtrim.purchase_order_lines (
  id bigint generated always as identity primary key,
  analysis_id uuid not null,
  job_id bigint not null,
  -- As printed, kept so a line can be matched again when the Job changes.
  work_order_no varchar(60) not null check (btrim(work_order_no) <> ''),
  page integer check (page is null or page >= 1),
  lot_raw varchar(100),
  phase_raw varchar(100),
  plan_raw varchar(100),
  -- The system's Plan is the printed Plan plus its elevation ("4" + "B" = "4B").
  elevation_raw varchar(100),
  tract_raw varchar(100),
  -- Normalized printed Phase and Lot: they group the revisions of the same Lot
  -- while the line is not matched with a Lot yet.
  phase_key varchar(100) not null default '',
  lot_key varchar(100) not null default '',
  option_code_raw varchar(60) not null check (btrim(option_code_raw) <> ''),
  option_code_key varchar(60) not null check (option_code_key <> ''),
  reference_no varchar(60) not null check (btrim(reference_no) <> ''),
  po_date date,
  revised_on date,
  quantity numeric(12,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null,
  total numeric(14,2) not null,
  description_lines text[] not null default '{}',
  -- "Cost has changed from $0.00 to $81.00": the price before the revision.
  previous_cost numeric(14,2),
  -- What the header matched. A Lot that is deleted later leaves the line
  -- unmatched, never removed.
  lot_id bigint references valtrim.lots(id) on delete set null,
  phase_id bigint references valtrim.phases(id) on delete set null,
  plan_id bigint references valtrim.plans(id) on delete set null,
  header_status text not null
    check (header_status in (
      'resolved', 'suggested', 'ambiguous', 'plan_mismatch',
      'lot_not_found', 'phase_not_found'
    )),
  -- Short reasons for the reviewer (printed values and candidates), no document text.
  header_match jsonb not null default '{}'::jsonb
    check (jsonb_typeof(header_match) = 'object'),
  -- Chosen only when the code alone does not identify the option (the Plan has
  -- several active options with that code). Otherwise the comparison finds it.
  plan_option_id bigint references valtrim.plan_options(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, job_id)
    references valtrim.purchase_order_analyses (id, job_id) on delete cascade
);

create index purchase_order_lines_analysis_idx
  on valtrim.purchase_order_lines (analysis_id);

create index purchase_order_lines_job_lot_option_idx
  on valtrim.purchase_order_lines (job_id, lot_id, option_code_key);

create index purchase_order_lines_job_printed_idx
  on valtrim.purchase_order_lines (job_id, phase_key, lot_key, option_code_key);

create index purchase_order_lines_lot_idx
  on valtrim.purchase_order_lines (lot_id) where lot_id is not null;

create index purchase_order_lines_phase_idx
  on valtrim.purchase_order_lines (phase_id) where phase_id is not null;

create index purchase_order_lines_plan_idx
  on valtrim.purchase_order_lines (plan_id) where plan_id is not null;

create index purchase_order_lines_plan_option_idx
  on valtrim.purchase_order_lines (plan_option_id) where plan_option_id is not null;

-- Learned names ---------------------------------------------------------------------

-- "Models" printed by a builder and "MODELS" in the system are matched once by a
-- reviewer and remembered here, per Job. Keys are the normalized texts.
create table valtrim.purchase_order_aliases (
  id bigint generated always as identity primary key,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  kind text not null check (kind in ('phase', 'plan')),
  raw_key varchar(100) not null check (raw_key <> ''),
  target_key varchar(100) not null check (target_key <> ''),
  created_by uuid references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, kind, raw_key)
);

create index purchase_order_aliases_created_by_idx
  on valtrim.purchase_order_aliases (created_by) where created_by is not null;

-- Access ------------------------------------------------------------------------------

alter table valtrim.purchase_order_analyses enable row level security;
alter table valtrim.purchase_order_lines enable row level security;
alter table valtrim.purchase_order_aliases enable row level security;

revoke all on valtrim.purchase_order_analyses from public, anon, authenticated;
revoke all on valtrim.purchase_order_lines from public, anon, authenticated;
revoke all on valtrim.purchase_order_aliases from public, anon, authenticated;
revoke all on sequence valtrim.purchase_order_lines_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.purchase_order_aliases_id_seq
  from public, anon, authenticated;

-- Prices of a Purchase Order are read by the same users that read Option prices.
grant select on valtrim.purchase_order_analyses to authenticated;
grant select on valtrim.purchase_order_lines to authenticated;
grant select on valtrim.purchase_order_aliases to authenticated;

grant select, insert, update, delete
  on valtrim.purchase_order_analyses to service_role;
grant select, insert, update, delete
  on valtrim.purchase_order_lines to service_role;
grant select, insert, update, delete
  on valtrim.purchase_order_aliases to service_role;
grant usage on sequence valtrim.purchase_order_lines_id_seq to service_role;
grant usage on sequence valtrim.purchase_order_aliases_id_seq to service_role;

create policy purchase_order_analyses_select
on valtrim.purchase_order_analyses for select to authenticated
using ((select private.is_active_user()));

create policy purchase_order_lines_select
on valtrim.purchase_order_lines for select to authenticated
using ((select private.is_active_user()));

create policy purchase_order_aliases_select
on valtrim.purchase_order_aliases for select to authenticated
using ((select private.is_active_user()));

-- Saving an analysis -------------------------------------------------------------------

-- Replaces every line of an analysis and marks it done, in one transaction. A
-- second analysis of the same document (force) therefore never leaves a half
-- written list. Only the Edge Function (service_role) can call it.
create function valtrim.save_purchase_order_analysis(
  p_analysis_id uuid,
  p_status text,
  p_columns jsonb,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
begin
  if p_status not in ('analyzed', 'not_option_po') then
    raise exception 'An analysis ends as analyzed or not_option_po'
      using errcode = '22023';
  end if;

  if p_lines is null
     or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) > 5000 then
    raise exception 'Save between 0 and 5000 Purchase Order lines'
      using errcode = '22023';
  end if;

  if p_status = 'analyzed' and jsonb_array_length(p_lines) = 0 then
    raise exception 'An analyzed Purchase Order has at least one line'
      using errcode = '22023';
  end if;

  select analysis.job_id
    into v_job_id
  from valtrim.purchase_order_analyses analysis
  where analysis.id = p_analysis_id
  for update;

  if not found then
    raise exception 'The Purchase Order analysis no longer exists'
      using errcode = '23503';
  end if;

  delete from valtrim.purchase_order_lines
  where analysis_id = p_analysis_id;

  insert into valtrim.purchase_order_lines (
    analysis_id, job_id, work_order_no, page, lot_raw, phase_raw, plan_raw,
    elevation_raw, tract_raw, phase_key, lot_key, option_code_raw,
    option_code_key, reference_no, po_date, revised_on, quantity, unit_price,
    total, description_lines, previous_cost, lot_id, phase_id, plan_id,
    header_status, header_match, plan_option_id
  )
  select
    p_analysis_id, v_job_id, line.work_order_no, line.page, line.lot_raw,
    line.phase_raw, line.plan_raw, line.elevation_raw, line.tract_raw,
    coalesce(line.phase_key, ''), coalesce(line.lot_key, ''),
    line.option_code_raw, line.option_code_key, line.reference_no,
    line.po_date, line.revised_on, line.quantity, line.unit_price, line.total,
    coalesce(line.description_lines, '{}'), line.previous_cost, line.lot_id,
    line.phase_id, line.plan_id, line.header_status,
    coalesce(line.header_match, '{}'::jsonb), line.plan_option_id
  from jsonb_populate_recordset(null::valtrim.purchase_order_lines, p_lines) line;

  update valtrim.purchase_order_analyses
  set status = p_status,
      parser = p_columns ->> 'parser',
      page_count = (p_columns ->> 'page_count')::integer,
      issues = coalesce(p_columns -> 'issues', '[]'::jsonb),
      -- Why a PDF is not a supported Purchase Order (not_option_po only).
      error = nullif(left(p_columns ->> 'error', 1000), ''),
      analyzed_at = now()
  where id = p_analysis_id;
end;
$$;

revoke execute on function valtrim.save_purchase_order_analysis(uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.save_purchase_order_analysis(uuid, text, jsonb, jsonb)
  to service_role;

-- The latest revision wins ------------------------------------------------------------------

-- One line per Lot and option code: the most recent revision (revision date, then
-- PO date, then Reference#, which only grows). Older PDFs stay as history. A line
-- not matched with a Lot yet is grouped by the Phase and Lot it prints.
create view valtrim.purchase_order_current_lines
with (security_invoker = true)
as
select ranked.*
from (
  select
    line.*,
    analysis.job_document_id,
    row_number() over (
      partition by
        line.job_id,
        coalesce(line.lot_id::text, line.phase_key || '/' || line.lot_key),
        line.option_code_key
      order by
        line.revised_on desc nulls last,
        line.po_date desc nulls last,
        line.reference_no desc,
        analysis.created_at desc,
        line.id desc
    ) as revision_rank
  from valtrim.purchase_order_lines line
  join valtrim.purchase_order_analyses analysis on analysis.id = line.analysis_id
) ranked
where ranked.revision_rank = 1;

revoke all on valtrim.purchase_order_current_lines from public, anon, authenticated;
grant select on valtrim.purchase_order_current_lines to authenticated, service_role;

-- Comparing with the system ------------------------------------------------------------------

-- What each current Purchase Order line says against what the system holds. The
-- system price is the one the Lot really bills: the price pinned to the Lot's
-- option, or today's price while none is pinned. Statuses, most urgent first:
--
--   HEADER_UNRESOLVED  the Lot of the PO was not found (or fits more than one)
--   PLAN_MISMATCH      the Lot exists but its Plan is not the one the PO prints
--   MISSING_OPTION     the Lot's Plan has no option with that code
--   AMBIGUOUS_OPTION   several options share the code and the description is unclear
--   NOT_IN_LOT         the option exists but the Lot does not have it selected
--   PRICE_DIFF         the PO price and the system price differ (or there is no price)
--   MATCH              everything agrees
--
-- conflicting_po_prices is true when POs of other Lots of the same Plan print a
-- different price for this option: an option has one price per Plan.
create function valtrim.compare_purchase_orders(p_job_id bigint)
returns table (
  line_id bigint,
  job_document_id uuid,
  work_order_no varchar,
  reference_no varchar,
  po_date date,
  revised_on date,
  lot_raw varchar,
  phase_raw varchar,
  plan_raw varchar,
  elevation_raw varchar,
  option_code_raw varchar,
  description_lines text[],
  quantity numeric,
  po_unit_price numeric,
  header_status text,
  header_match jsonb,
  lot_id bigint,
  lot_number varchar,
  phase_id bigint,
  phase_code varchar,
  building varchar,
  plan_id bigint,
  plan_code varchar,
  plan_option_id bigint,
  option_name varchar,
  system_price numeric,
  system_not_applicable boolean,
  conflicting_po_prices boolean,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    current_line.id,
    current_line.job_document_id,
    current_line.work_order_no,
    current_line.reference_no,
    current_line.po_date,
    current_line.revised_on,
    current_line.lot_raw,
    current_line.phase_raw,
    current_line.plan_raw,
    current_line.elevation_raw,
    current_line.option_code_raw,
    current_line.description_lines,
    current_line.quantity,
    current_line.unit_price,
    current_line.header_status,
    current_line.header_match,
    lot.id,
    lot.lot_number,
    phase.id,
    phase.code,
    phase.building,
    plan.id,
    plan.code,
    chosen.id,
    chosen.name,
    case when pinned.id is not null then pinned.price else open_price.price end,
    coalesce(
      case when pinned.id is not null then pinned.is_not_applicable
           else open_price.is_not_applicable end,
      false
    ),
    coalesce(
      min(current_line.unit_price) over (
        partition by lot.plan_id, current_line.option_code_key
      ) <> max(current_line.unit_price) over (
        partition by lot.plan_id, current_line.option_code_key
      ),
      false
    ),
    case
      when lot.id is null
        or current_line.header_status in ('ambiguous', 'lot_not_found', 'phase_not_found')
        then 'HEADER_UNRESOLVED'
      when current_line.header_status = 'plan_mismatch' then 'PLAN_MISMATCH'
      when chosen.id is null and candidates.total = 0 then 'MISSING_OPTION'
      when chosen.id is null then 'AMBIGUOUS_OPTION'
      when selected.option_id is null then 'NOT_IN_LOT'
      when (case when pinned.id is not null then pinned.price
                 else open_price.price end)
           is distinct from current_line.unit_price then 'PRICE_DIFF'
      else 'MATCH'
    end
  from valtrim.purchase_order_current_lines current_line
  left join valtrim.lots lot on lot.id = current_line.lot_id
  left join valtrim.phases phase on phase.id = lot.phase_id
  left join valtrim.plans plan on plan.id = lot.plan_id
  left join lateral (
    select
      count(*) as total,
      (array_agg(option.id order by option.id))[1] as only_id
    from valtrim.plan_options option
    where option.plan_id = lot.plan_id
      and option.is_active
      and private.option_code_key(option.code) = current_line.option_code_key
  ) candidates on true
  left join valtrim.plan_options chosen on chosen.id = case
    when current_line.plan_option_id is not null
      and exists (
        select 1
        from valtrim.plan_options explicit_option
        where explicit_option.id = current_line.plan_option_id
          and explicit_option.plan_id = lot.plan_id
          and explicit_option.is_active
      ) then current_line.plan_option_id
    when candidates.total = 1 then candidates.only_id
  end
  left join valtrim.lot_options selected
    on selected.lot_id = lot.id and selected.option_id = chosen.id
  left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
  left join valtrim.option_prices open_price
    on open_price.option_id = chosen.id and open_price.effective_to is null
  where current_line.job_id = p_job_id
  order by lot.lot_number, current_line.option_code_key, current_line.id
$$;

revoke execute on function valtrim.compare_purchase_orders(bigint)
  from public, anon;
grant execute on function valtrim.compare_purchase_orders(bigint)
  to authenticated, service_role;

-- The other direction: options a Lot has selected that no Purchase Order covers.
-- Only Lots that already have a Purchase Order are looked at; a Lot without any is
-- not "uncovered", it simply has no PO yet.
create function valtrim.purchase_order_uncovered_options(p_job_id bigint)
returns table (
  lot_id bigint,
  lot_number varchar,
  phase_code varchar,
  building varchar,
  plan_id bigint,
  option_id bigint,
  option_code varchar,
  option_name varchar,
  system_price numeric,
  system_not_applicable boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    lot.id,
    lot.lot_number,
    phase.code,
    phase.building,
    lot.plan_id,
    option.id,
    option.code,
    option.name,
    case when pinned.id is not null then pinned.price else open_price.price end,
    coalesce(
      case when pinned.id is not null then pinned.is_not_applicable
           else open_price.is_not_applicable end,
      false
    )
  from valtrim.lot_options selected
  join valtrim.lots lot on lot.id = selected.lot_id
  join valtrim.phases phase on phase.id = lot.phase_id
  join valtrim.plan_options option on option.id = selected.option_id
  left join valtrim.option_prices pinned on pinned.id = selected.option_price_id
  left join valtrim.option_prices open_price
    on open_price.option_id = option.id and open_price.effective_to is null
  where lot.job_id = p_job_id
    and exists (
      select 1
      from valtrim.purchase_order_current_lines covered_lot
      where covered_lot.job_id = p_job_id
        and covered_lot.lot_id = lot.id
    )
    and not exists (
      select 1
      from valtrim.purchase_order_current_lines covering
      where covering.job_id = p_job_id
        and covering.lot_id = lot.id
        and covering.option_code_key = private.option_code_key(option.code)
    )
  order by lot.lot_number, option.code
$$;

revoke execute on function valtrim.purchase_order_uncovered_options(bigint)
  from public, anon;
grant execute on function valtrim.purchase_order_uncovered_options(bigint)
  to authenticated, service_role;

comment on table valtrim.purchase_order_analyses is
  'One analysis per PURCHASE_ORDER Job document. Written by the analyze Edge Function.';
comment on table valtrim.purchase_order_lines is
  'Option lines printed by a Purchase Order, matched with the Job''s Lot. The comparison with the system is live (compare_purchase_orders).';
comment on table valtrim.purchase_order_aliases is
  'Phase and Plan names a reviewer matched by hand, remembered per Job.';
comment on view valtrim.purchase_order_current_lines is
  'The latest revision of each Lot option across all Purchase Orders of a Job.';

commit;
