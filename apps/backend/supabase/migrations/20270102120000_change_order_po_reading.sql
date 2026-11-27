-- Extras / Change Orders, Documents (stage 2): the orders read from each Purchase Order PDF.
--
-- The change-order-po-read Edge Function reads a PDF (OCR for scanned pages, AI for where each order is
-- and what it says, every number checked against the printed text) and saves what it found here. One
-- PDF holds one or more orders (change_order_pos), each with one or more lines (a Lot or a group of
-- Lots with their printed amount). Reading again replaces what was found before.
--
-- Only the function writes (service role, through the functions below, granted to it alone, after it checked the
-- caller's role). Every active user reads.

begin;

alter table valtrim.change_order_po_files
  add column read_status varchar(12) not null default 'UNREAD'
    check (read_status in ('UNREAD', 'READING', 'READ', 'FAILED')),
  add column read_started_at timestamptz,
  add column read_at timestamptz,
  add column read_error varchar(500),
  add column read_model varchar(80),
  add column page_count integer check (page_count is null or page_count between 1 and 100),
  add column ocr_pages integer[] not null default '{}';

grant select (read_status, read_started_at, read_at, read_error, read_model, page_count, ocr_pages)
  on valtrim.change_order_po_files to authenticated;

create table valtrim.change_order_pos (
  id bigint generated always as identity primary key,
  file_id uuid not null references valtrim.change_order_po_files(id) on delete cascade,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  position integer not null check (position >= 1),
  po_number varchar(80) check (po_number is null or btrim(po_number) <> ''),
  number_label varchar(60),
  document_kind varchar(20) not null default 'OTHER'
    check (document_kind in ('PURCHASE_ORDER', 'CHANGE_ORDER', 'WORK_ORDER', 'FIELD_PO', 'CONTRACT', 'OTHER')),
  issued_date date,
  pages integer[] not null default '{}',
  builder_text varchar(200),
  project_text varchar(200),
  description varchar(2000),
  total_amount numeric(14,2),
  net_amount numeric(14,2),
  other_numbers jsonb not null default '[]'::jsonb check (jsonb_typeof(other_numbers) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz not null default now(),
  unique (file_id, position)
);

create index change_order_pos_job_idx on valtrim.change_order_pos (job_id);
create index change_order_pos_number_idx on valtrim.change_order_pos (job_id, po_number);

create table valtrim.change_order_po_lines (
  po_id bigint not null references valtrim.change_order_pos(id) on delete cascade,
  line_number integer not null check (line_number >= 1),
  lots text[] not null default '{}',
  lots_text varchar(300),
  lots_checked boolean not null default false,
  phase varchar(40),
  building varchar(80),
  plan varchar(80),
  description varchar(1000),
  amount numeric(14,2),
  primary key (po_id, line_number)
);

alter table valtrim.change_order_pos enable row level security;
alter table valtrim.change_order_po_lines enable row level security;

revoke all on valtrim.change_order_pos from public, anon, authenticated;
revoke all on valtrim.change_order_po_lines from public, anon, authenticated;

grant select on valtrim.change_order_pos to authenticated;
grant select on valtrim.change_order_po_lines to authenticated;
grant select, insert, update, delete on valtrim.change_order_pos, valtrim.change_order_po_lines to service_role;

create policy change_order_pos_select
on valtrim.change_order_pos for select to authenticated
using ((select private.is_active_user()));

create policy change_order_po_lines_select
on valtrim.change_order_po_lines for select to authenticated
using ((select private.is_active_user()));

-- Marks a PDF as being read. Refused while another reading of it started less than five minutes ago
-- (a reading that died long ago does not block it forever). Returns the Job of the PDF.
create function valtrim.claim_change_order_po_read(p_file_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
begin
  update valtrim.change_order_po_files file
  set read_status = 'READING', read_started_at = now(), read_error = null
  where file.id = p_file_id
    and (file.read_status <> 'READING' or file.read_started_at < now() - interval '5 minutes')
  returning file.job_id into v_job_id;

  if v_job_id is null then
    if exists (select 1 from valtrim.change_order_po_files where id = p_file_id) then
      raise exception 'This PDF is already being read. Wait a moment.'
        using errcode = '55P03';
    end if;
    raise exception 'The Purchase Order PDF is no longer available'
      using errcode = 'P0002';
  end if;
  return v_job_id;
end;
$$;

-- Saves what was read, replacing what an earlier reading found. p_orders: an array of
-- { number, number_label, kind, pages[], date, builder, project, description, total, net_total,
--   other_numbers[], warnings[], lines: [{ lots[], lots_text, lots_checked, phase, building, plan,
--   description, amount }] } with amounts in dollars.
create function valtrim.save_change_order_po_read(
  p_file_id uuid,
  p_orders jsonb,
  p_model text,
  p_page_count integer,
  p_ocr_pages integer[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
  v_order jsonb;
  v_line jsonb;
  v_po_id bigint;
  v_position integer := 0;
  v_line_number integer;
begin
  select file.job_id into v_job_id
  from valtrim.change_order_po_files file
  where file.id = p_file_id
  for update;
  if v_job_id is null then
    raise exception 'The Purchase Order PDF is no longer available'
      using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_orders) <> 'array' then
    raise exception 'The orders must be a list'
      using errcode = '22023';
  end if;

  delete from valtrim.change_order_pos where file_id = p_file_id;

  for v_order in select value from jsonb_array_elements(p_orders)
  loop
    v_position := v_position + 1;
    insert into valtrim.change_order_pos (
      file_id, job_id, position, po_number, number_label, document_kind, issued_date, pages,
      builder_text, project_text, description, total_amount, net_amount, other_numbers, warnings
    ) values (
      p_file_id,
      v_job_id,
      v_position,
      nullif(btrim(v_order ->> 'number'), ''),
      nullif(btrim(v_order ->> 'number_label'), ''),
      coalesce(v_order ->> 'kind', 'OTHER'),
      (v_order ->> 'date')::date,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_order -> 'pages', '[]'::jsonb))::integer), '{}'),
      nullif(btrim(v_order ->> 'builder'), ''),
      nullif(btrim(v_order ->> 'project'), ''),
      nullif(btrim(v_order ->> 'description'), ''),
      (v_order ->> 'total')::numeric,
      (v_order ->> 'net_total')::numeric,
      coalesce(v_order -> 'other_numbers', '[]'::jsonb),
      coalesce(v_order -> 'warnings', '[]'::jsonb)
    )
    returning id into v_po_id;

    v_line_number := 0;
    for v_line in select value from jsonb_array_elements(coalesce(v_order -> 'lines', '[]'::jsonb))
    loop
      v_line_number := v_line_number + 1;
      insert into valtrim.change_order_po_lines (
        po_id, line_number, lots, lots_text, lots_checked, phase, building, plan, description, amount
      ) values (
        v_po_id,
        v_line_number,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_line -> 'lots', '[]'::jsonb))), '{}'),
        nullif(btrim(v_line ->> 'lots_text'), ''),
        coalesce((v_line ->> 'lots_checked')::boolean, false),
        nullif(btrim(v_line ->> 'phase'), ''),
        nullif(btrim(v_line ->> 'building'), ''),
        nullif(btrim(v_line ->> 'plan'), ''),
        nullif(btrim(v_line ->> 'description'), ''),
        (v_line ->> 'amount')::numeric
      );
    end loop;
  end loop;

  update valtrim.change_order_po_files
  set read_status = 'READ',
      read_at = now(),
      read_error = null,
      read_model = left(p_model, 80),
      page_count = p_page_count,
      ocr_pages = coalesce(p_ocr_pages, '{}')
  where id = p_file_id;

  return v_position;
end;
$$;

-- A reading that failed: the reason is kept for the person, and what an earlier reading found stays.
create function valtrim.fail_change_order_po_read(p_file_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update valtrim.change_order_po_files
  set read_status = case when exists (select 1 from valtrim.change_order_pos where file_id = p_file_id)
                         then 'READ' else 'FAILED' end,
      read_error = left(coalesce(nullif(btrim(p_error), ''), 'The PDF could not be read.'), 500)
  where id = p_file_id;
$$;

revoke execute on function valtrim.claim_change_order_po_read(uuid) from public, anon, authenticated;
revoke execute on function valtrim.save_change_order_po_read(uuid, jsonb, text, integer, integer[]) from public, anon, authenticated;
revoke execute on function valtrim.fail_change_order_po_read(uuid, text) from public, anon, authenticated;
grant execute on function valtrim.claim_change_order_po_read(uuid) to service_role;
grant execute on function valtrim.save_change_order_po_read(uuid, jsonb, text, integer, integer[]) to service_role;
grant execute on function valtrim.fail_change_order_po_read(uuid, text) to service_role;

comment on table valtrim.change_order_pos is
  'The orders read from a builder Purchase Order PDF of a Job (one PDF can hold several).';
comment on table valtrim.change_order_po_lines is
  'The Lots and printed amounts of an order read from a Purchase Order PDF.';

notify pgrst, 'reload schema';

commit;
