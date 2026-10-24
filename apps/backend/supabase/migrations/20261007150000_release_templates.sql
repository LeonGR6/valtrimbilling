-- Phase 44: Release templates.
--
-- A RELEASE Job document can be analyzed and confirmed as the Release template
-- of a Job. This phase only classifies the Release type, stores detected field
-- suggestions and stores the user-confirmed mapping. Filling the PDF comes later.
--
-- Writes follow the Job document model: browsers never write the table. The
-- analyze Edge Function writes analysis results as service_role after checking
-- the caller's role, and confirmation goes through a role-checked RPC.
-- The full OCR text is never stored (it contains financial data); only short
-- evidence snippets and detected labels are kept in jsonb columns.

begin;

create type valtrim.release_type as enum (
  'ConditionalWaiverAndReleaseOnProgressPayment',
  'ConditionalWaiverAndReleaseOnFinalPayment',
  'UnconditionalWaiverAndReleaseOnProgressPayment',
  'UnconditionalWaiverAndReleaseOnFinalPayment'
);

create table valtrim.release_templates (
  id uuid primary key default gen_random_uuid(),
  -- Deleting the PDF deletes its template (the confirmed mapping included).
  job_document_id uuid not null unique
    references valtrim.job_documents(id) on delete cascade,
  -- Denormalized for the one-confirmed-template rule. A trigger derives it
  -- from the document so it can never disagree.
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  -- null = not classified yet.
  release_type valtrim.release_type,
  -- { method, confidence, evidence, candidates[] }. Short evidence only.
  classification jsonb not null default '{}'::jsonb
    check (jsonb_typeof(classification) = 'object'),
  detection_method text
    check (detection_method in ('acroform', 'text_layer', 'ocr')),
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
  -- Suggestions only: [{ variable, label, confidence, source, hint }].
  detected_fields jsonb not null default '[]'::jsonb
    check (jsonb_typeof(detected_fields) = 'array'),
  -- User-confirmed mapping, validated by
  -- private.validate_release_template_mapping. null until confirmed.
  mapping jsonb check (mapping is null or jsonb_typeof(mapping) = 'object'),
  status text not null default 'analyzing'
    check (status in (
      'analyzing', 'needs_review', 'confirmed', 'superseded', 'failed'
    )),
  error text check (error is null or char_length(error) <= 1000),
  requested_by uuid not null references valtrim.app_users(id) on delete restrict,
  confirmed_by uuid references valtrim.app_users(id) on delete restrict,
  confirmed_at timestamptz,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_templates_analyzed_check check (
    status not in ('needs_review', 'confirmed', 'superseded')
    or (
      analyzed_at is not null
      and detection_method is not null
      and page_count is not null
      and page_sizes is not null
    )
  ),
  constraint release_templates_confirmed_check check (
    status not in ('confirmed', 'superseded')
    or (
      release_type is not null
      and mapping is not null
      and confirmed_by is not null
      and confirmed_at is not null
    )
  ),
  constraint release_templates_failed_check check (
    status <> 'failed' or error is not null
  )
);

-- One confirmed template per Job and Release type.
create unique index release_templates_confirmed_job_type_key
  on valtrim.release_templates (job_id, release_type)
  where status = 'confirmed';

create index release_templates_job_status_idx
  on valtrim.release_templates (job_id, status);

create index release_templates_requested_by_idx
  on valtrim.release_templates (requested_by);

create index release_templates_confirmed_by_idx
  on valtrim.release_templates (confirmed_by)
  where confirmed_by is not null;

create function private.sync_release_template_document()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_document valtrim.job_documents%rowtype;
begin
  if tg_op = 'UPDATE'
     and new.job_document_id is distinct from old.job_document_id then
    raise exception 'A Release template cannot move to another document'
      using errcode = '23514';
  end if;

  select document.*
    into v_document
  from valtrim.job_documents document
  where document.id = new.job_document_id;

  if not found or v_document.document_type <> 'RELEASE' then
    raise exception 'Release templates require a RELEASE Job document'
      using errcode = '23514';
  end if;

  new.job_id := v_document.job_id;
  return new;
end;
$$;

create trigger release_templates_sync_document
before insert or update on valtrim.release_templates
for each row execute function private.sync_release_template_document();

create trigger release_templates_set_updated_at
before update on valtrim.release_templates
for each row execute function valtrim.set_updated_at();

alter table valtrim.release_templates enable row level security;

revoke all on valtrim.release_templates from public, anon, authenticated;
grant select on valtrim.release_templates to authenticated;
grant select, insert, update, delete on valtrim.release_templates to service_role;

create policy release_templates_select
on valtrim.release_templates for select to authenticated
using ((select private.is_active_user()));

-- Variables a Release template can map. Kept in one place so a new variable is
-- a one-function migration. Mirrored by the client schema.
create function private.release_template_variables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['through_date', 'check_amount']::text[];
$$;

-- Mapping shape (version 1):
--   { "version": 1,
--     "fields": [
--       { "variable": "through_date",
--         "target": { "kind": "rect", "page": 1, "x": 0.1, "y": 0.2, "w": 0.2, "h": 0.03 },
--         "fontSize": 10,
--         "format": "MM/DD/YYYY",
--         "cover": false },                      -- cover is optional
--       { "variable": "check_amount",
--         "target": { "kind": "acroform", "fieldName": "Amount of Check" },
--         "fontSize": 10, "format": "currency" } ] }
-- Rect coordinates are normalized 0-1, origin at the top-left of the page as
-- displayed (after the page /Rotate), so they survive different page sizes.
create function private.validate_release_template_mapping(
  p_mapping jsonb,
  p_page_count integer
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_field jsonb;
  v_target jsonb;
  v_variable text;
  v_format text;
  v_font numeric;
  v_key text;
  v_page numeric;
  v_x numeric;
  v_y numeric;
  v_w numeric;
  v_h numeric;
  v_count integer;
begin
  if p_mapping is null
     or jsonb_typeof(p_mapping) <> 'object'
     or p_mapping -> 'version' is distinct from to_jsonb(1)
     or jsonb_typeof(p_mapping -> 'fields') is distinct from 'array'
     or exists (
       select 1 from jsonb_object_keys(p_mapping) key
       where key not in ('version', 'fields')
     ) then
    raise exception 'The mapping must be a version 1 object with a fields list'
      using errcode = '23514';
  end if;

  v_count := jsonb_array_length(p_mapping -> 'fields');
  if v_count not between 1 and 12 then
    raise exception 'Map between 1 and 12 fields'
      using errcode = '23514';
  end if;

  for v_field in
    select item.value from jsonb_array_elements(p_mapping -> 'fields') item
  loop
    if jsonb_typeof(v_field) <> 'object'
       or exists (
         select 1 from jsonb_object_keys(v_field) key
         where key not in ('variable', 'target', 'fontSize', 'format', 'cover')
       ) then
      raise exception 'Each mapped field must be an object with known properties'
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_field -> 'variable') is distinct from 'string'
       or (v_field ->> 'variable') <> all (private.release_template_variables()) then
      raise exception 'Select a supported Release variable'
        using errcode = '23514';
    end if;
    v_variable := v_field ->> 'variable';

    v_format := v_field ->> 'format';
    if jsonb_typeof(v_field -> 'format') is distinct from 'string'
       or not (
         (v_variable = 'through_date'
           and v_format in ('MM/DD/YYYY', 'MMMM D, YYYY', 'YYYY-MM-DD'))
         or (v_variable = 'check_amount'
           and v_format in ('currency', 'plain'))
       ) then
      raise exception 'Select a supported format for %', v_variable
        using errcode = '23514';
    end if;

    if jsonb_typeof(v_field -> 'fontSize') is distinct from 'number' then
      raise exception 'Enter a font size between 4 and 48'
        using errcode = '23514';
    end if;
    v_font := (v_field ->> 'fontSize')::numeric;
    if v_font < 4 or v_font > 48 then
      raise exception 'Enter a font size between 4 and 48'
        using errcode = '23514';
    end if;

    if v_field ? 'cover'
       and jsonb_typeof(v_field -> 'cover') <> 'boolean' then
      raise exception 'The cover option must be true or false'
        using errcode = '23514';
    end if;

    v_target := v_field -> 'target';
    if jsonb_typeof(v_target) is distinct from 'object' then
      raise exception 'Each mapped field needs a target'
        using errcode = '23514';
    end if;

    if v_target ->> 'kind' = 'rect' then
      if exists (
        select 1 from jsonb_object_keys(v_target) key
        where key not in ('kind', 'page', 'x', 'y', 'w', 'h')
      ) then
        raise exception 'A rectangle target has unknown properties'
          using errcode = '23514';
      end if;

      foreach v_key in array array['page', 'x', 'y', 'w', 'h']
      loop
        if jsonb_typeof(v_target -> v_key) is distinct from 'number' then
          raise exception 'A rectangle target needs numeric page, x, y, w and h'
            using errcode = '23514';
        end if;
      end loop;

      v_page := (v_target ->> 'page')::numeric;
      v_x := (v_target ->> 'x')::numeric;
      v_y := (v_target ->> 'y')::numeric;
      v_w := (v_target ->> 'w')::numeric;
      v_h := (v_target ->> 'h')::numeric;

      if v_page <> trunc(v_page)
         or v_page < 1
         or v_page > coalesce(p_page_count, 0) then
        raise exception 'The rectangle page is outside the document'
          using errcode = '23514';
      end if;

      if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1
         or v_w <= 0 or v_h <= 0
         or v_x + v_w > 1.000001 or v_y + v_h > 1.000001 then
        raise exception 'The rectangle must stay inside the page'
          using errcode = '23514';
      end if;
    elsif v_target ->> 'kind' = 'acroform' then
      if exists (
        select 1 from jsonb_object_keys(v_target) key
        where key not in ('kind', 'fieldName')
      ) then
        raise exception 'A form field target has unknown properties'
          using errcode = '23514';
      end if;

      if jsonb_typeof(v_target -> 'fieldName') is distinct from 'string'
         or btrim(v_target ->> 'fieldName') <> (v_target ->> 'fieldName')
         or char_length(v_target ->> 'fieldName') not between 1 and 200 then
        raise exception 'A form field target needs a field name'
          using errcode = '23514';
      end if;
    else
      raise exception 'Select a rectangle or form field target'
        using errcode = '23514';
    end if;
  end loop;
end;
$$;

create function private.confirm_release_template(
  p_template_id uuid,
  p_release_type valtrim.release_type,
  p_mapping jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_template valtrim.release_templates%rowtype;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'ACCOUNTING',
       'PROJECT_MANAGEMENT'
     )) then
    raise exception 'You do not have permission to confirm Release templates'
      using errcode = '42501';
  end if;

  if p_release_type is null then
    raise exception 'Select the Release type'
      using errcode = '23514';
  end if;

  select template.*
    into v_template
  from valtrim.release_templates template
  where template.id = p_template_id
  for update;

  if not found then
    raise exception 'The Release template is no longer available'
      using errcode = 'P0002';
  end if;

  if v_template.status not in ('needs_review', 'confirmed') then
    raise exception 'Only an analyzed Release template can be confirmed'
      using errcode = '55000';
  end if;

  perform private.validate_release_template_mapping(
    p_mapping,
    v_template.page_count
  );

  -- Serialize confirmations for the same Job and Release type; the partial
  -- unique index remains the final guard.
  perform pg_advisory_xact_lock(
    hashtextextended(v_template.job_id::text || ':' || p_release_type::text, 0)
  );

  update valtrim.release_templates previous
  set status = 'superseded'
  where previous.job_id = v_template.job_id
    and previous.release_type = p_release_type
    and previous.status = 'confirmed'
    and previous.id <> v_template.id;

  update valtrim.release_templates template
  set release_type = p_release_type,
      mapping = p_mapping,
      status = 'confirmed',
      error = null,
      confirmed_by = v_actor_id,
      confirmed_at = now()
  where template.id = v_template.id;

  return v_template.id;
end;
$$;

create function valtrim.confirm_release_template(
  p_template_id uuid,
  p_release_type valtrim.release_type,
  p_mapping jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.confirm_release_template(
    p_template_id,
    p_release_type,
    p_mapping
  );
$$;

revoke execute on function private.release_template_variables()
  from public, anon, authenticated;
revoke execute on function private.validate_release_template_mapping(jsonb, integer)
  from public, anon, authenticated;
revoke execute on function private.confirm_release_template(
  uuid, valtrim.release_type, jsonb
) from public, anon, authenticated;
revoke execute on function valtrim.confirm_release_template(
  uuid, valtrim.release_type, jsonb
) from public, anon, authenticated;

grant execute on function private.release_template_variables()
  to authenticated, service_role;
grant execute on function private.validate_release_template_mapping(jsonb, integer)
  to authenticated, service_role;
grant execute on function private.confirm_release_template(
  uuid, valtrim.release_type, jsonb
) to authenticated, service_role;
grant execute on function valtrim.confirm_release_template(
  uuid, valtrim.release_type, jsonb
) to authenticated, service_role;

comment on table valtrim.release_templates is
  'Analysis and confirmed field mapping of a RELEASE Job document used as a Release template. Never stores full OCR text.';
comment on column valtrim.release_templates.mapping is
  'Confirmed mapping, version 1. Rect coordinates are normalized 0-1 with the origin at the top-left of the page as displayed (after /Rotate).';
comment on column valtrim.release_templates.detected_fields is
  'Unconfirmed suggestions only. The confirmed mapping is the source of truth.';
comment on function valtrim.confirm_release_template(
  uuid, valtrim.release_type, jsonb
) is
  'Validates and confirms a Release template mapping and supersedes the previous confirmed template of the same Job and type. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on policy release_templates_select on valtrim.release_templates is
  'Active authenticated users can read Release template metadata; writes go through the analyze Edge Function and the confirm RPC.';

notify pgrst, 'reload schema';

commit;
