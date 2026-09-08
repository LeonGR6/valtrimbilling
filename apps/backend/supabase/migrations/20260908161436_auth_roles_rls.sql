begin;

-- Phase 0: identity, authorization and a closed-by-default Data API surface.
-- The baseline creates the business schema but deliberately leaves it closed.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type valtrim.app_role as enum (
  'ADMIN',
  'ACCOUNTING',
  'PROJECT_MANAGEMENT',
  'SCHEDULING',
  'FIELD',
  'READ_ONLY'
);

create table valtrim.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  name varchar(100) not null check (btrim(name) <> ''),
  email valtrim.email_address not null,
  phone valtrim.phone_number,
  role valtrim.app_role not null default 'READ_ONLY',
  all_projects boolean not null default true,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index app_users_email_uq
  on valtrim.app_users (lower(email));

create table valtrim.user_community_access (
  user_id uuid not null references valtrim.app_users(id) on delete cascade,
  community_id bigint not null references valtrim.communities(id) on delete cascade,
  granted_by uuid references valtrim.app_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, community_id)
);

create index user_community_access_community_idx
  on valtrim.user_community_access (community_id, user_id);

create trigger app_users_set_updated_at
before update on valtrim.app_users
for each row execute function valtrim.set_updated_at();

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into valtrim.app_users (id, name, email, last_login_at)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'New user'
    ),
    lower(coalesce(new.email, new.id::text || '@pending.local')),
    new.last_sign_in_at
  )
  on conflict (id) do update
  set email = excluded.email,
      last_login_at = excluded.last_login_at,
      updated_at = now();

  return new;
end;
$$;

create or replace function private.sync_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.app_users
  set email = lower(coalesce(new.email, new.id::text || '@pending.local')),
      last_login_at = new.last_sign_in_at,
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user()
  from public, anon, authenticated;
revoke all on function private.sync_auth_user()
  from public, anon, authenticated;

drop trigger if exists valtrim_on_auth_user_created on auth.users;
create trigger valtrim_on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

drop trigger if exists valtrim_on_auth_user_changed on auth.users;
create trigger valtrim_on_auth_user_changed
after update of email, last_sign_in_at on auth.users
for each row execute function private.sync_auth_user();

-- Existing Auth users are preserved, but start with the least privileged role.
insert into valtrim.app_users (id, name, email, last_login_at)
select
  u.id,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    'New user'
  ),
  lower(coalesce(u.email, u.id::text || '@pending.local')),
  u.last_sign_in_at
from auth.users u
on conflict (id) do update
set email = excluded.email,
    last_login_at = excluded.last_login_at,
    updated_at = now();

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from valtrim.app_users u
    where u.id = (select auth.uid())
      and u.is_active
  );
$$;

create or replace function private.has_app_role(variadic allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from valtrim.app_users u
    where u.id = (select auth.uid())
      and u.is_active
      and u.role::text = any(allowed_roles)
  );
$$;

create or replace function private.can_access_community(target_community_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from valtrim.app_users u
    where u.id = (select auth.uid())
      and u.is_active
      and (
        u.all_projects
        or exists (
          select 1
          from valtrim.user_community_access access
          where access.user_id = u.id
            and access.community_id = target_community_id
        )
      )
  );
$$;

revoke all on function private.is_active_user()
  from public, anon;
revoke all on function private.has_app_role(text[])
  from public, anon;
revoke all on function private.can_access_community(bigint)
  from public, anon;

grant usage on schema private to authenticated, service_role;
grant execute on function private.is_active_user()
  to authenticated, service_role;
grant execute on function private.has_app_role(text[])
  to authenticated, service_role;
grant execute on function private.can_access_community(bigint)
  to authenticated, service_role;

-- Browser writes cannot forge audit identities. Service-role operations are
-- intentionally exempt because they run without an end-user JWT.
create or replace function private.stamp_and_validate_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_column text;
  new_row jsonb;
  old_row jsonb;
begin
  if actor_id is null then
    return new;
  end if;

  new_row := to_jsonb(new);
  old_row := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;

  if tg_op = 'INSERT' and new_row ? 'created_by' then
    new_row := jsonb_set(new_row, '{created_by}', to_jsonb(actor_id), true);
  end if;

  if new_row ? 'updated_by' then
    new_row := jsonb_set(new_row, '{updated_by}', to_jsonb(actor_id), true);
  end if;

  foreach actor_column in array array[
    'created_by', 'updated_by', 'activated_by', 'selected_by',
    'changed_by', 'uploaded_by', 'submitted_by', 'voided_by',
    'completed_by', 'closed_by'
  ]
  loop
    if new_row ? actor_column
       and (tg_op = 'INSERT' or new_row -> actor_column is distinct from old_row -> actor_column)
       and new_row ->> actor_column is not null
       and (new_row ->> actor_column)::uuid <> actor_id then
      raise exception 'Audit actor % must match the authenticated user', actor_column
        using errcode = '42501';
    end if;
  end loop;

  new := jsonb_populate_record(new, new_row);
  return new;
end;
$$;

revoke all on function private.stamp_and_validate_actor()
  from public, anon, authenticated;

do $$
declare
  target_table text;
begin
  for target_table in
    select distinct c.table_name
    from information_schema.columns c
    where c.table_schema = 'valtrim'
      and c.column_name in (
        'created_by', 'updated_by', 'activated_by', 'selected_by',
        'changed_by', 'uploaded_by', 'submitted_by', 'voided_by',
        'completed_by', 'closed_by'
      )
  loop
    execute format(
      'create trigger stamp_and_validate_actor before insert or update on valtrim.%I for each row execute function private.stamp_and_validate_actor()',
      target_table
    );
  end loop;
end;
$$;

-- Add referential integrity for every audit actor without rejecting legacy
-- rows during this rollout. New and changed rows are checked immediately;
-- the constraints can be validated after legacy data has been reviewed.
do $$
declare
  actor_column record;
  constraint_name text;
begin
  for actor_column in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'valtrim'
      and c.data_type = 'uuid'
      and c.column_name in (
        'created_by', 'updated_by', 'activated_by', 'selected_by',
        'changed_by', 'uploaded_by', 'submitted_by', 'voided_by',
        'completed_by', 'closed_by', 'coordinator_user_id'
      )
  loop
    constraint_name := left(
      actor_column.table_name || '_' || actor_column.column_name || '_app_users_fk',
      63
    );

    if not exists (
      select 1
      from pg_constraint constraint_record
      join pg_class table_record on table_record.oid = constraint_record.conrelid
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'valtrim'
        and table_record.relname = actor_column.table_name
        and constraint_record.conname = constraint_name
    ) then
      execute format(
        'alter table valtrim.%I add constraint %I foreign key (%I) references valtrim.app_users(id) on delete set null not valid',
        actor_column.table_name,
        constraint_name,
        actor_column.column_name
      );
    end if;
  end loop;
end;
$$;

-- Close the complete business schema first. Each later feature migration must
-- opt into the exact grants and policies it needs.
revoke all on schema valtrim from public, anon, authenticated;
revoke all on all tables in schema valtrim from public, anon, authenticated;
revoke all on all sequences in schema valtrim from public, anon, authenticated;
revoke execute on all functions in schema valtrim from public, anon, authenticated;

grant usage on schema valtrim to authenticated, service_role;
grant all on all tables in schema valtrim to service_role;
grant all on all sequences in schema valtrim to service_role;
grant execute on all functions in schema valtrim to service_role;

do $$
declare
  target_table text;
begin
  for target_table in
    select table_record.relname
    from pg_class table_record
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relkind in ('r', 'p')
  loop
    execute format('alter table valtrim.%I enable row level security', target_table);
  end loop;
end;
$$;

grant select on valtrim.app_users to authenticated;
grant select, insert, update, delete on valtrim.user_community_access to authenticated;

create policy app_users_select
on valtrim.app_users for select to authenticated
using (
  id = (select auth.uid())
  or (select private.has_app_role('ADMIN'))
);

create policy user_community_access_select
on valtrim.user_community_access for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.has_app_role('ADMIN'))
);

create policy user_community_access_insert
on valtrim.user_community_access for insert to authenticated
with check ((select private.has_app_role('ADMIN')));

create policy user_community_access_update
on valtrim.user_community_access for update to authenticated
using ((select private.has_app_role('ADMIN')))
with check ((select private.has_app_role('ADMIN')));

create policy user_community_access_delete
on valtrim.user_community_access for delete to authenticated
using ((select private.has_app_role('ADMIN')));

alter default privileges for role postgres in schema valtrim
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema valtrim
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema valtrim
  revoke execute on routines from public, anon, authenticated;
alter default privileges for role postgres in schema valtrim
  grant all on tables to service_role;
alter default privileges for role postgres in schema valtrim
  grant all on sequences to service_role;
alter default privileges for role postgres in schema valtrim
  grant execute on routines to service_role;

do $$
begin
  if exists (
    select 1
    from pg_class table_record
    join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'valtrim'
      and table_record.relkind in ('r', 'p')
      and not table_record.relrowsecurity
  ) then
    raise exception 'Every table in valtrim must have RLS enabled';
  end if;
end;
$$;

commit;
