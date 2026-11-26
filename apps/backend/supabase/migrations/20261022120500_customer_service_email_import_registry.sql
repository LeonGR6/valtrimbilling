-- Email import block 1: durable receipt and read-only operational visibility.
-- No mailbox connection, uploads, extraction, worker, or request creation here.
begin;

create type valtrim.service_request_import_status as enum (
  'PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'PROCESSED'
);

create table valtrim.service_request_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mailbox_id text collate "C" not null,
  provider_message_id text collate "C" not null,
  source_payload jsonb not null default '{}'::jsonb,
  attachment_refs jsonb not null default '[]'::jsonb,
  status valtrim.service_request_import_status not null default 'PENDING',
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_code text,
  error_message text,
  extraction_payload jsonb,
  request_id bigint references valtrim.service_requests(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_request_imports_message_uq
    unique (tenant_id, mailbox_id, provider_message_id),
  constraint service_request_imports_identity_check check (
    mailbox_id <> '' and mailbox_id = btrim(mailbox_id)
    and provider_message_id <> '' and provider_message_id = btrim(provider_message_id)
  ),
  constraint service_request_imports_source_check check (
    jsonb_typeof(source_payload) = 'object'
  ),
  constraint service_request_imports_attachment_refs_check check (
    jsonb_typeof(attachment_refs) = 'array'
    and not jsonb_path_exists(attachment_refs, '$[*] ? (@.type() != "object")')
  ),
  constraint service_request_imports_extraction_check check (
    extraction_payload is null or jsonb_typeof(extraction_payload) = 'object'
  ),
  constraint service_request_imports_attempt_count_check check (attempt_count >= 0),
  constraint service_request_imports_processing_check check (
    status <> 'PROCESSING' or (
      attempt_count > 0 and last_attempt_at is not null and processing_started_at is not null
    )
  ),
  constraint service_request_imports_attention_check check (
    status <> 'NEEDS_ATTENTION' or (
      error_message is not null and btrim(error_message) <> ''
    )
  ),
  constraint service_request_imports_processed_check check (
    status <> 'PROCESSED' or (request_id is not null and processed_at is not null)
  )
);

create index service_request_imports_status_created_idx
  on valtrim.service_request_imports (status, created_at desc, id desc);
create index service_request_imports_created_idx
  on valtrim.service_request_imports (created_at desc, id desc);
create index service_request_imports_request_idx
  on valtrim.service_request_imports (request_id) where request_id is not null;

-- Retries can update processing data, but cannot change which email this is or
-- replace a request already associated with it. Original source enrichment and
-- attachment persistence belong to later ingestion blocks, not to replay.
create function private.guard_customer_service_import_identity()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if row(new.id, new.tenant_id, new.mailbox_id, new.provider_message_id, new.created_at)
     is distinct from
     row(old.id, old.tenant_id, old.mailbox_id, old.provider_message_id, old.created_at)
     or (old.request_id is not null and new.request_id is distinct from old.request_id) then
    raise exception 'Email import identity and an associated request cannot be replaced'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

revoke all on function private.guard_customer_service_import_identity()
  from public, anon, authenticated, service_role;

create trigger service_request_imports_guard_identity
before update on valtrim.service_request_imports
for each row execute function private.guard_customer_service_import_identity();

create trigger service_request_imports_set_updated_at
before update on valtrim.service_request_imports
for each row execute function valtrim.set_updated_at();

alter table valtrim.service_request_imports enable row level security;
revoke all on valtrim.service_request_imports from public, anon, authenticated, service_role;
grant select on valtrim.service_request_imports to authenticated;
grant select, insert, update on valtrim.service_request_imports to service_role;

create policy service_request_imports_select
on valtrim.service_request_imports for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

-- Only the trusted backend registers email receipts. The unique constraint is
-- the concurrency arbiter: duplicate deliveries never overwrite an existing row.
-- The import UUID is also the stable submission key for the later save RPC.
create function valtrim.register_customer_service_email_import(
  p_tenant_id uuid,
  p_mailbox_id text,
  p_provider_message_id text,
  p_source_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_replay boolean := false;
begin
  if p_tenant_id is null
     or p_mailbox_id is null or btrim(p_mailbox_id) = '' or p_mailbox_id <> btrim(p_mailbox_id)
     or p_provider_message_id is null or btrim(p_provider_message_id) = ''
     or p_provider_message_id <> btrim(p_provider_message_id) then
    raise exception 'Tenant, mailbox and stable message identity are required without surrounding spaces'
      using errcode = '22023';
  end if;
  if p_source_payload is null or jsonb_typeof(p_source_payload) <> 'object' then
    raise exception 'Email source payload must be an object' using errcode = '22023';
  end if;

  insert into valtrim.service_request_imports (
    tenant_id, mailbox_id, provider_message_id, source_payload
  ) values (
    p_tenant_id, p_mailbox_id, p_provider_message_id, p_source_payload
  ) on conflict on constraint service_request_imports_message_uq do nothing
  returning * into v_import;

  if not found then
    v_replay := true;
    select * into strict v_import
    from valtrim.service_request_imports
    where tenant_id = p_tenant_id
      and mailbox_id = p_mailbox_id collate "C"
      and provider_message_id = p_provider_message_id collate "C";
  end if;

  return jsonb_build_object(
    'importId', v_import.id,
    'submissionKey', v_import.id,
    'status', v_import.status,
    'requestId', v_import.request_id,
    'idempotentReplay', v_replay
  );
end;
$function$;

-- Summary only: the inbox panel must not load every email body, attachment
-- reference or extraction. Offset pagination is sufficient for the prototype.
create function valtrim.list_customer_service_email_imports(
  p_status valtrim.service_request_import_status default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  perform private.require_customer_service_actor();
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception 'Import page size must be between 1 and 100 and offset must be nonnegative'
      using errcode = '22023';
  end if;

  return query
  select jsonb_build_object(
    'id', receipt.id,
    'tenant_id', receipt.tenant_id,
    'mailbox_id', receipt.mailbox_id,
    'provider_message_id', receipt.provider_message_id,
    'subject', receipt.source_payload ->> 'subject',
    'from', receipt.source_payload -> 'from',
    'status', receipt.status,
    'attempt_count', receipt.attempt_count,
    'last_attempt_at', receipt.last_attempt_at,
    'processing_started_at', receipt.processing_started_at,
    'processed_at', receipt.processed_at,
    'error_code', receipt.error_code,
    'error_message', receipt.error_message,
    'request_id', receipt.request_id,
    'request_folio', request.folio,
    'created_at', receipt.created_at,
    'updated_at', receipt.updated_at
  )
  from valtrim.service_request_imports receipt
  left join valtrim.service_requests request on request.id = receipt.request_id
  where p_status is null or receipt.status = p_status
  order by receipt.created_at desc, receipt.id desc
  limit p_limit offset p_offset;
end;
$function$;

create function valtrim.read_customer_service_email_import(p_import_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_record jsonb;
begin
  perform private.require_customer_service_actor();
  if p_import_id is null then
    raise exception 'Import identity is required' using errcode = '22023';
  end if;

  select to_jsonb(receipt) || jsonb_build_object('request_folio', request.folio)
  into v_record
  from valtrim.service_request_imports receipt
  left join valtrim.service_requests request on request.id = receipt.request_id
  where receipt.id = p_import_id;

  if not found then
    raise exception 'Email import not found' using errcode = 'P0002';
  end if;
  return v_record;
end;
$function$;

create function valtrim.count_customer_service_email_imports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_counts jsonb;
begin
  perform private.require_customer_service_actor();
  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where status = 'PENDING'),
    'processing', count(*) filter (where status = 'PROCESSING'),
    'needsAttention', count(*) filter (where status = 'NEEDS_ATTENTION'),
    'processed', count(*) filter (where status = 'PROCESSED')
  ) into v_counts
  from valtrim.service_request_imports;
  return v_counts;
end;
$function$;

revoke all on function valtrim.register_customer_service_email_import(uuid, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function valtrim.register_customer_service_email_import(uuid, text, text, jsonb)
  to service_role;

revoke all on function valtrim.list_customer_service_email_imports(valtrim.service_request_import_status, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function valtrim.read_customer_service_email_import(uuid)
  from public, anon, authenticated, service_role;
revoke all on function valtrim.count_customer_service_email_imports()
  from public, anon, authenticated, service_role;
grant execute on function valtrim.list_customer_service_email_imports(valtrim.service_request_import_status, integer, integer)
  to authenticated;
grant execute on function valtrim.read_customer_service_email_import(uuid) to authenticated;
grant execute on function valtrim.count_customer_service_email_imports() to authenticated;

comment on table valtrim.service_request_imports is
  'Microsoft 365 email receipts, independent of request workflow. No connector or worker is enabled by this schema.';
comment on column valtrim.service_request_imports.provider_message_id is
  'Case-sensitive stable message ID (Graph ImmutableId); never use a folder-dependent ID or a conversation ID as this identity.';
comment on column valtrim.service_request_imports.source_payload is
  'Original email snapshot: metadata, body text/HTML and attachment metadata. Not AI output, credentials or attachment binary/base64. HTML is untrusted and must not be rendered unsanitized.';
comment on column valtrim.service_request_imports.attachment_refs is
  'Private storage references populated by a later ingestion block. No public/signed URLs or binary data; an empty list does not assert that the email has no attachments.';
comment on column valtrim.service_request_imports.extraction_payload is
  'Machine extraction result, separate from the original email and later human edits.';
comment on column valtrim.service_request_imports.id is
  'Persistent receipt identity and submission key for later idempotent request creation; never generate a new key per retry.';
comment on column valtrim.service_request_imports.status is
  'Technical import status, not service_workflow_stage. PROCESSED means saved/linked, not human-approved.';

notify pgrst, 'reload schema';
commit;
