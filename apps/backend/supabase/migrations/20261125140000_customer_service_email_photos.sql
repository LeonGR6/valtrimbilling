-- Email photos as reduced WebP copies (decided 25 Nov 2026). For photos, this replaces
-- the "email images without retention" rule of 28 Oct 2026: each photo of a processed
-- email (JPEG or PNG of 50 KB or more; small inline logos and signatures are left out)
-- is reduced to 1600 px on its long side and saved as WebP, about 90% smaller than the
-- original, which stays in Outlook. Their text is still extracted as before.
--
-- The Edge Function customer-service-email-photos converts one photo per call (measured
-- on 25 Nov 2026: about 0.75 s of the 2 s CPU limit), called by pg_cron every minute.
-- This table is its queue and the record of each stored copy. ADMIN and SCHEDULING see
-- the copies in the request through short-lived signed links; only the server writes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 1. A private bucket for the WebP copies only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-service-photos', 'customer-service-photos', false, 2000000, array['image/webp']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy customer_service_photos_read on storage.objects
for select to authenticated
using (bucket_id = 'customer-service-photos' and (select private.has_app_role('ADMIN', 'SCHEDULING')));

-- 2. One row per photo of a processed email: PENDING until converted, then STORED; FAILED
-- after its attempts run out (the request still has the text extracted from it).
create table valtrim.service_request_photos (
  id bigint generated always as identity primary key,
  import_id uuid not null references valtrim.service_request_imports(id) on delete cascade,
  attachment_id text not null check (btrim(attachment_id) <> '' and length(attachment_id) <= 512),
  request_id bigint not null references valtrim.service_requests(id) on delete cascade,
  original_filename text not null check (length(original_filename) between 1 and 255),
  original_mime_type text not null check (original_mime_type in ('image/jpeg', 'image/png')),
  original_size_bytes integer not null check (original_size_bytes > 0),
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  original_is_inline boolean not null default false,
  original_content_id text check (length(original_content_id) <= 512),
  status text not null default 'PENDING' check (status in ('PENDING', 'STORED', 'FAILED')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error text check (length(last_error) <= 500),
  object_path text check (length(object_path) <= 300),
  width integer check (width > 0),
  height integer check (height > 0),
  size_bytes integer check (size_bytes > 0),
  stored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (import_id, attachment_id),
  check (status <> 'STORED' or (object_path is not null and width is not null and height is not null
    and size_bytes is not null and stored_at is not null))
);
comment on table valtrim.service_request_photos is
  'Photos of processed Customer Service emails, stored as reduced WebP copies in the customer-service-photos bucket. Written only by the Edge Function customer-service-email-photos (service role).';

create index service_request_photos_stored on valtrim.service_request_photos (request_id) where status = 'STORED';
create index service_request_photos_due on valtrim.service_request_photos (next_attempt_at) where status = 'PENDING';

create trigger service_request_photos_set_updated_at
before update on valtrim.service_request_photos
for each row execute function valtrim.set_updated_at();

alter table valtrim.service_request_photos enable row level security;
revoke all on valtrim.service_request_photos from public, anon, authenticated;
grant select on valtrim.service_request_photos to authenticated;
grant select, insert, update, delete on valtrim.service_request_photos to service_role;

create policy service_request_photos_select
on valtrim.service_request_photos for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

-- 3. Where a processed email lives in Outlook, so the photo function can download one of
-- its photos. Like read_customer_service_graph_image_source, without the worker lease,
-- because the import is already processed. Service role only.
create function valtrim.read_customer_service_photo_source(p_import_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_import valtrim.service_request_imports%rowtype;
  v_connection private.customer_service_email_connections%rowtype;
begin
  select * into v_import from valtrim.service_request_imports where id = p_import_id;
  if not found or v_import.source_contract_version <> 2 or v_import.status::text <> 'PROCESSED'
     or v_import.source_status <> 'AVAILABLE' then
    return jsonb_build_object('importId', p_import_id, 'connectionAvailable', false);
  end if;
  select * into v_connection from private.customer_service_email_connections where id = v_import.source_connection_id;
  if not found or not v_connection.enabled
     or v_connection.tenant_id is distinct from v_import.tenant_id
     or v_connection.mailbox_id::text is distinct from v_import.mailbox_id then
    return jsonb_build_object('importId', p_import_id, 'connectionAvailable', false);
  end if;
  return jsonb_build_object(
    'importId', v_import.id, 'connectionAvailable', true,
    'tenantId', v_connection.tenant_id, 'mailboxId', v_connection.mailbox_id, 'folderId', v_connection.folder_id,
    'messageId', v_import.provider_message_id, 'retryNotBefore', v_connection.retry_not_before
  );
end;
$function$;

revoke all on function valtrim.read_customer_service_photo_source(uuid) from public, anon, authenticated;
grant execute on function valtrim.read_customer_service_photo_source(uuid) to service_role;
comment on function valtrim.read_customer_service_photo_source(uuid) is
  'Service role only. The Outlook origin (tenant, mailbox, folder, message) of a processed V2 email import, for converting its photos.';

-- 4. Every minute, one photo per call. Run details are kept one week.
select cron.schedule(
  'customer-service-email-photos',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select automation.project_url from private.customer_service_email_automation automation where automation.singleton)
        || '/functions/v1/customer-service-email-photos',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'customer-service-email-photos')
      and end_time < now() - interval '7 days';
  $cron$
);

notify pgrst, 'reload schema';
commit;
