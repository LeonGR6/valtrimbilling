begin;

-- Application-level audit trail. Supabase keeps technical and Auth logs; this
-- table records business actions in language the ValtrimBilling UI can use.
create table valtrim.audit_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null default gen_random_uuid(),
  module varchar(50) not null
    check (module ~ '^[A-Z][A-Z0-9_]*$'),
  action varchar(80) not null
    check (action ~ '^[A-Z][A-Z0-9_]*$'),
  result varchar(20) not null default 'SUCCESS'
    check (result in ('SUCCESS', 'REJECTED', 'FAILED')),
  actor_type varchar(20) not null default 'USER'
    check (actor_type in ('USER', 'SYSTEM')),
  actor_user_id uuid references valtrim.app_users(id) on delete set null,
  actor_name varchar(100) not null check (btrim(actor_name) <> ''),
  actor_email valtrim.email_address,
  actor_role varchar(50),
  target_user_id uuid references valtrim.app_users(id) on delete set null,
  target_name varchar(100),
  target_email valtrim.email_address,
  entity_type varchar(50) not null
    check (entity_type ~ '^[A-Z][A-Z0-9_]*$'),
  entity_id varchar(100),
  entity_label varchar(200),
  summary text not null check (btrim(summary) <> ''),
  previous_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(previous_values) = 'object'),
  new_values jsonb not null default '{}'::jsonb
    check (jsonb_typeof(new_values) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  search_text text generated always as (
    lower(
      coalesce(actor_name, '') || ' ' ||
      coalesce(actor_email::text, '') || ' ' ||
      coalesce(target_name, '') || ' ' ||
      coalesce(target_email::text, '') || ' ' ||
      coalesce(entity_label, '') || ' ' ||
      coalesce(summary, '')
    )
  ) stored,
  created_at timestamptz not null default now()
);

comment on table valtrim.audit_events is
  'Append-only business audit trail for user actions across ValtrimBilling modules.';
comment on column valtrim.audit_events.correlation_id is
  'Groups multiple audit rows produced by one application operation.';
comment on column valtrim.audit_events.previous_values is
  'Non-sensitive values before the business operation.';
comment on column valtrim.audit_events.new_values is
  'Non-sensitive values after the business operation.';

create index audit_events_created_at_idx
  on valtrim.audit_events (created_at desc);
create index audit_events_module_created_at_idx
  on valtrim.audit_events (module, created_at desc);
create index audit_events_action_created_at_idx
  on valtrim.audit_events (action, created_at desc);
create index audit_events_result_created_at_idx
  on valtrim.audit_events (result, created_at desc);
create index audit_events_actor_created_at_idx
  on valtrim.audit_events (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index audit_events_target_created_at_idx
  on valtrim.audit_events (target_user_id, created_at desc)
  where target_user_id is not null;
create index audit_events_entity_created_at_idx
  on valtrim.audit_events (entity_type, entity_id, created_at desc)
  where entity_id is not null;

alter table valtrim.audit_events enable row level security;

revoke all on valtrim.audit_events from public, anon, authenticated;
grant select on valtrim.audit_events to authenticated;
grant all on valtrim.audit_events to service_role;

create policy audit_events_admin_select
on valtrim.audit_events for select to authenticated
using ((select private.has_app_role('ADMIN')));

commit;
