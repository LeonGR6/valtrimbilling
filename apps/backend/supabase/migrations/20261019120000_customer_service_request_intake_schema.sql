-- Customer Service request intake persistence.
--
-- This migration is deliberately additive. It prepares the relational model
-- used by New Request without replacing the legacy scheduling contract, wiring
-- the frontend, changing folios/SLA calculations, or provisioning Storage.

begin;

create type valtrim.service_request_workflow_stage as enum (
  'NEEDS_REVIEW',
  'READY_TO_PROPOSE',
  'AWAITING_CUSTOMER',
  'NEEDS_CONTACT',
  'CONFIRMED',
  'WORKING',
  'COMPLETED'
);

create type valtrim.service_kind as enum (
  'ADJUSTMENT',
  'REPLACEMENT',
  'PAID_EXTRA'
);

create type valtrim.service_work_category as enum (
  'EXTERIOR_FRAMES',
  'DOORS',
  'MOLDINGS',
  'HARDWARE',
  'WEATHERSTRIPPING',
  'SHELVING',
  'MULTIPLE_WORK_TYPES'
);

create type valtrim.service_task as enum (
  'GENERAL_FIX',
  'EXTERIOR_DOOR_REPLACEMENT',
  'EXTERIOR_FRAME_REPLACEMENT',
  'SHUTTER_REPLACEMENT',
  'SHELVING_REPLACEMENT'
);

create type valtrim.service_request_contact_role as enum (
  'PRIMARY',
  'ADDITIONAL'
);

create type valtrim.service_reported_on_source as enum (
  'EMAIL_SENT',
  'ORDER_DATE',
  'SCHEDULED_DATE',
  'MANUAL'
);

create type valtrim.service_request_source_type as enum (
  'PDF',
  'EMAIL_TEXT'
);

create type valtrim.service_request_source_file_status as enum (
  'NOT_APPLICABLE',
  'PENDING',
  'AVAILABLE',
  'FAILED'
);

-- Jobs remain the source of Builder, Community text, and verified coordinates.
-- service_properties.community_id is retained only for the legacy Customer
-- Service model; Jobs intentionally no longer reference that catalog.
alter table valtrim.service_properties
  add column job_id bigint
    references valtrim.jobs(id) on delete restrict,
  alter column address drop not null;

create index service_properties_job_idx
  on valtrim.service_properties (job_id)
  where job_id is not null;

alter table valtrim.service_requests
  add column submission_key uuid,
  add column workflow_stage valtrim.service_request_workflow_stage
    not null default 'NEEDS_REVIEW',
  add column reported_on_source valtrim.service_reported_on_source
    not null default 'MANUAL',
  add column service_kind valtrim.service_kind,
  add column work_category valtrim.service_work_category,
  add column service_task valtrim.service_task,
  add column crew_size smallint
    check (crew_size between 1 and 10),
  add column reviewed_at timestamptz,
  add column reviewed_by uuid
    references valtrim.app_users(id) on delete set null,
  add column valtrim_items_confirmed boolean not null default false;

create unique index service_requests_submission_key_uq
  on valtrim.service_requests (submission_key)
  where submission_key is not null;

create index service_requests_workflow_inbox_idx
  on valtrim.service_requests (workflow_stage, due_on, created_at desc);

create index service_requests_reviewed_by_idx
  on valtrim.service_requests (reviewed_by)
  where reviewed_by is not null;

create table valtrim.service_request_contacts (
  id bigint generated always as identity primary key,
  request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  role valtrim.service_request_contact_role not null,
  name varchar(100) not null,
  email valtrim.email_address,
  phone valtrim.phone_number,
  created_by uuid
    references valtrim.app_users(id) on delete set null,
  updated_by uuid
    references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_request_contacts_name_check
    check (btrim(name) <> ''),
  constraint service_request_contacts_method_check
    check (email is not null or phone is not null),
  constraint service_request_contacts_role_uq
    unique (request_id, role)
);

create index service_request_contacts_created_by_idx
  on valtrim.service_request_contacts (created_by)
  where created_by is not null;

create index service_request_contacts_updated_by_idx
  on valtrim.service_request_contacts (updated_by)
  where updated_by is not null;

create table valtrim.service_request_items (
  id bigint generated always as identity primary key,
  request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  item_number smallint not null,
  description varchar(1000) not null,
  material_required boolean not null default false,
  chargeable boolean not null default false,
  created_by uuid
    references valtrim.app_users(id) on delete set null,
  updated_by uuid
    references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_request_items_number_check
    check (item_number between 1 and 25),
  constraint service_request_items_description_check
    check (btrim(description) <> ''),
  constraint service_request_items_number_uq
    unique (request_id, item_number)
);

create index service_request_items_created_by_idx
  on valtrim.service_request_items (created_by)
  where created_by is not null;

create index service_request_items_updated_by_idx
  on valtrim.service_request_items (updated_by)
  where updated_by is not null;

create table valtrim.service_request_sources (
  id bigint generated always as identity primary key,
  request_id bigint not null unique
    references valtrim.service_requests(id) on delete cascade,
  source_type valtrim.service_request_source_type not null,
  sender_email valtrim.email_address,
  subject varchar(250),
  email_text text,
  file_id bigint unique
    references valtrim.stored_files(id) on delete restrict,
  file_status valtrim.service_request_source_file_status not null,
  extracted_text text,
  extraction_payload jsonb,
  extraction_model varchar(120),
  extracted_at timestamptz,
  review_notes text[] not null default '{}'::text[],
  file_error varchar(1000),
  created_by uuid
    references valtrim.app_users(id) on delete set null,
  updated_by uuid
    references valtrim.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_request_sources_subject_check
    check (subject is null or btrim(subject) <> ''),
  constraint service_request_sources_email_text_limit_check
    check (email_text is null or char_length(email_text) <= 50000),
  constraint service_request_sources_extraction_payload_check
    check (
      extraction_payload is null
      or jsonb_typeof(extraction_payload) = 'object'
    ),
  constraint service_request_sources_extraction_model_check
    check (extraction_model is null or btrim(extraction_model) <> ''),
  constraint service_request_sources_input_check
    check (
      (
        source_type = 'EMAIL_TEXT'
        and email_text is not null
        and btrim(email_text) <> ''
        and file_id is null
        and file_status = 'NOT_APPLICABLE'
        and file_error is null
      )
      or
      (
        source_type = 'PDF'
        and email_text is null
        and (
          (
            file_status = 'PENDING'
            and file_id is null
            and file_error is null
          )
          or
          (
            file_status = 'AVAILABLE'
            and file_id is not null
            and file_error is null
          )
          or
          (
            file_status = 'FAILED'
            and file_id is null
            and file_error is not null
            and btrim(file_error) <> ''
          )
        )
      )
    )
);

create index service_request_sources_created_by_idx
  on valtrim.service_request_sources (created_by)
  where created_by is not null;

create index service_request_sources_updated_by_idx
  on valtrim.service_request_sources (updated_by)
  where updated_by is not null;

create table valtrim.service_request_workflow_history (
  id bigint generated always as identity primary key,
  request_id bigint not null
    references valtrim.service_requests(id) on delete cascade,
  previous_stage valtrim.service_request_workflow_stage,
  new_stage valtrim.service_request_workflow_stage not null,
  note varchar(500),
  changed_by uuid
    references valtrim.app_users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index service_request_workflow_history_request_idx
  on valtrim.service_request_workflow_history (request_id, changed_at desc);

create index service_request_workflow_history_changed_by_idx
  on valtrim.service_request_workflow_history (changed_by)
  where changed_by is not null;

create trigger service_request_contacts_set_updated_at
before update on valtrim.service_request_contacts
for each row execute function valtrim.set_updated_at();

create trigger service_request_contacts_stamp_actor
before insert or update on valtrim.service_request_contacts
for each row execute function private.stamp_and_validate_actor();

create trigger service_request_items_set_updated_at
before update on valtrim.service_request_items
for each row execute function valtrim.set_updated_at();

create trigger service_request_items_stamp_actor
before insert or update on valtrim.service_request_items
for each row execute function private.stamp_and_validate_actor();

create trigger service_request_sources_set_updated_at
before update on valtrim.service_request_sources
for each row execute function valtrim.set_updated_at();

create trigger service_request_sources_stamp_actor
before insert or update on valtrim.service_request_sources
for each row execute function private.stamp_and_validate_actor();

create function valtrim.record_service_request_workflow_stage_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.workflow_stage is distinct from old.workflow_stage then
    insert into valtrim.service_request_workflow_history (
      request_id,
      previous_stage,
      new_stage,
      changed_by
    )
    values (
      new.id,
      case when tg_op = 'INSERT' then null else old.workflow_stage end,
      new.workflow_stage,
      coalesce((select auth.uid()), new.updated_by, new.created_by)
    );
  end if;

  return new;
end;
$$;

revoke all on function valtrim.record_service_request_workflow_stage_change()
  from public, anon, authenticated;

create trigger service_requests_record_workflow_stage
after insert or update of workflow_stage on valtrim.service_requests
for each row
execute function valtrim.record_service_request_workflow_stage_change();

alter table valtrim.service_request_contacts enable row level security;
alter table valtrim.service_request_items enable row level security;
alter table valtrim.service_request_sources enable row level security;
alter table valtrim.service_request_workflow_history enable row level security;

revoke all on valtrim.service_request_contacts
  from public, anon, authenticated;
revoke all on valtrim.service_request_items
  from public, anon, authenticated;
revoke all on valtrim.service_request_sources
  from public, anon, authenticated;
revoke all on valtrim.service_request_workflow_history
  from public, anon, authenticated;

revoke all on sequence valtrim.service_request_contacts_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.service_request_items_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.service_request_sources_id_seq
  from public, anon, authenticated;
revoke all on sequence valtrim.service_request_workflow_history_id_seq
  from public, anon, authenticated;

grant select on valtrim.service_request_contacts to authenticated;
grant select on valtrim.service_request_items to authenticated;
grant select on valtrim.service_request_sources to authenticated;
grant select on valtrim.service_request_workflow_history to authenticated;

create policy service_request_contacts_select
on valtrim.service_request_contacts for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_request_items_select
on valtrim.service_request_items for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_request_sources_select
on valtrim.service_request_sources for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

create policy service_request_workflow_history_select
on valtrim.service_request_workflow_history for select to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING')));

comment on column valtrim.service_properties.job_id is
  'Job selected for this Customer Service property. Null is retained only for legacy rows.';

comment on column valtrim.service_requests.submission_key is
  'Client-generated idempotency key used by the future New Request RPC.';

comment on column valtrim.service_requests.workflow_stage is
  'Current Customer Service workflow stage. Overdue remains a derived alert.';

comment on table valtrim.service_request_contacts is
  'Primary and optional additional customer contacts captured for a service request.';

comment on table valtrim.service_request_items is
  'Ordered Valtrim work items included in one Customer Service request.';

comment on table valtrim.service_request_sources is
  'Optional immutable source email/PDF extraction reference for a service request.';

comment on table valtrim.service_request_workflow_history is
  'Append-only history of the new Customer Service workflow stage.';

notify pgrst, 'reload schema';

commit;
