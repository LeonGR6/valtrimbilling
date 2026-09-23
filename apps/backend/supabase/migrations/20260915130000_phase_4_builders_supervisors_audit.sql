begin;

-- Builders and Valtrim supervisors are already persisted through the Data API.
-- This phase adds business audit events without changing either CRUD flow.

create or replace function private.audit_builder_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_candidate uuid := coalesce(
    (select auth.uid()),
    new.updated_by,
    new.created_by
  );
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_previous_values jsonb := '{}'::jsonb;
  v_new_values jsonb;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_changed_fields text[] := array[]::text[];
  v_action text;
  v_summary text;
begin
  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = v_actor_candidate;

  v_new_snapshot := jsonb_build_object(
    'code', new.code,
    'name', new.name,
    'description', new.description,
    'address', new.address,
    'contact_name', new.contact_name,
    'contact_email', new.contact_email::text,
    'contact_phone', new.contact_phone::text,
    'is_active', new.is_active,
    'ext_to_dm_weeks', new.ext_to_dm_weeks,
    'shutter_before_dm_weeks', new.shutter_before_dm_weeks,
    'dm_to_hw_weeks', new.dm_to_hw_weeks
  );

  if tg_op = 'INSERT' then
    v_action := 'BUILDER_CREATED';
    v_new_values := v_new_snapshot;
    v_changed_fields := array[
      'code',
      'name',
      'description',
      'address',
      'contact_name',
      'contact_email',
      'contact_phone',
      'is_active',
      'ext_to_dm_weeks',
      'shutter_before_dm_weeks',
      'dm_to_hw_weeks'
    ];
    v_summary := format('Builder %s (%s) was created.', new.name, new.code);
  else
    v_old_snapshot := jsonb_build_object(
      'code', old.code,
      'name', old.name,
      'description', old.description,
      'address', old.address,
      'contact_name', old.contact_name,
      'contact_email', old.contact_email::text,
      'contact_phone', old.contact_phone::text,
      'is_active', old.is_active,
      'ext_to_dm_weeks', old.ext_to_dm_weeks,
      'shutter_before_dm_weeks', old.shutter_before_dm_weeks,
      'dm_to_hw_weeks', old.dm_to_hw_weeks
    );

    select
      coalesce(
        jsonb_object_agg(change.key, v_old_snapshot -> change.key),
        '{}'::jsonb
      ),
      coalesce(
        jsonb_object_agg(change.key, change.value),
        '{}'::jsonb
      ),
      coalesce(array_agg(change.key order by change.key), array[]::text[])
    into v_previous_values, v_new_values, v_changed_fields
    from jsonb_each(v_new_snapshot) change
    where v_old_snapshot -> change.key is distinct from change.value;

    if cardinality(v_changed_fields) = 0 then
      return new;
    end if;

    if old.is_active and not new.is_active then
      v_action := 'BUILDER_DEACTIVATED';
      v_summary := format('Builder %s (%s) was deactivated.', new.name, new.code);
    elsif not old.is_active and new.is_active then
      v_action := 'BUILDER_REACTIVATED';
      v_summary := format('Builder %s (%s) was reactivated.', new.name, new.code);
    else
      v_action := 'BUILDER_UPDATED';
      v_summary := format('Builder %s (%s) was updated.', new.name, new.code);
    end if;
  end if;

  insert into valtrim.audit_events (
    module,
    action,
    result,
    actor_type,
    actor_user_id,
    actor_name,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    entity_label,
    summary,
    previous_values,
    new_values,
    metadata
  )
  values (
    'BUILDERS',
    v_action,
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, 'System'),
    v_actor_email,
    v_actor_role,
    'BUILDER',
    new.id::text,
    new.name,
    v_summary,
    v_previous_values,
    v_new_values,
    jsonb_build_object(
      'builderCode', new.code,
      'isActive', new.is_active,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_builder_change()
  from public, anon, authenticated;

drop trigger if exists builders_audit on valtrim.builders;
create trigger builders_audit
after insert or update on valtrim.builders
for each row execute function private.audit_builder_change();

create or replace function private.audit_supervisor_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_candidate uuid;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_person_name text;
  v_person_email valtrim.email_address;
  v_phone text;
  v_office_phone text;
  v_territory text;
  v_is_active boolean;
begin
  if new.role <> 'SUPERVISOR' then
    return new;
  end if;

  select
    person.name,
    person.email,
    person.phone::text,
    person.office_phone::text,
    person.territory,
    person.is_active,
    coalesce((select auth.uid()), person.updated_by, person.created_by)
  into
    v_person_name,
    v_person_email,
    v_phone,
    v_office_phone,
    v_territory,
    v_is_active,
    v_actor_candidate
  from valtrim.people person
  where person.id = new.person_id;

  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = v_actor_candidate;

  insert into valtrim.audit_events (
    module,
    action,
    result,
    actor_type,
    actor_user_id,
    actor_name,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    entity_label,
    summary,
    previous_values,
    new_values,
    metadata
  )
  values (
    'PEOPLE',
    'SUPERVISOR_CREATED',
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, 'System'),
    v_actor_email,
    v_actor_role,
    'SUPERVISOR',
    new.person_id::text,
    v_person_name,
    format('Supervisor %s was added to Crews & Foremen.', v_person_name),
    '{}'::jsonb,
    jsonb_build_object(
      'name', v_person_name,
      'email', v_person_email::text,
      'phone', v_phone,
      'office_phone', v_office_phone,
      'territory', v_territory,
      'is_active', v_is_active,
      'role', new.role::text
    ),
    jsonb_build_object(
      'supervisorEmail', v_person_email::text,
      'territory', v_territory,
      'role', new.role::text,
      'isActive', v_is_active,
      'changedFields', to_jsonb(array[
        'name',
        'email',
        'phone',
        'office_phone',
        'territory',
        'is_active',
        'role'
      ]::text[])
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_supervisor_created()
  from public, anon, authenticated;

drop trigger if exists supervisor_roles_audit on valtrim.person_roles;
create trigger supervisor_roles_audit
after insert on valtrim.person_roles
for each row execute function private.audit_supervisor_created();

create or replace function private.audit_supervisor_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_candidate uuid := coalesce(
    (select auth.uid()),
    new.updated_by,
    new.created_by
  );
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_previous_values jsonb := '{}'::jsonb;
  v_new_values jsonb;
  v_old_snapshot jsonb;
  v_new_snapshot jsonb;
  v_changed_fields text[] := array[]::text[];
  v_action text;
  v_summary text;
begin
  if not exists (
    select 1
    from valtrim.person_roles person_role
    where person_role.person_id = new.id
      and person_role.role = 'SUPERVISOR'
  ) then
    return new;
  end if;

  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = v_actor_candidate;

  v_old_snapshot := jsonb_build_object(
    'name', old.name,
    'email', old.email::text,
    'phone', old.phone::text,
    'office_phone', old.office_phone::text,
    'territory', old.territory,
    'is_active', old.is_active
  );
  v_new_snapshot := jsonb_build_object(
    'name', new.name,
    'email', new.email::text,
    'phone', new.phone::text,
    'office_phone', new.office_phone::text,
    'territory', new.territory,
    'is_active', new.is_active
  );

  select
    coalesce(
      jsonb_object_agg(change.key, v_old_snapshot -> change.key),
      '{}'::jsonb
    ),
    coalesce(
      jsonb_object_agg(change.key, change.value),
      '{}'::jsonb
    ),
    coalesce(array_agg(change.key order by change.key), array[]::text[])
  into v_previous_values, v_new_values, v_changed_fields
  from jsonb_each(v_new_snapshot) change
  where v_old_snapshot -> change.key is distinct from change.value;

  if cardinality(v_changed_fields) = 0 then
    return new;
  end if;

  if old.is_active and not new.is_active then
    v_action := 'SUPERVISOR_DEACTIVATED';
    v_summary := format('Supervisor %s was deactivated.', new.name);
  elsif not old.is_active and new.is_active then
    v_action := 'SUPERVISOR_REACTIVATED';
    v_summary := format('Supervisor %s was reactivated.', new.name);
  else
    v_action := 'SUPERVISOR_UPDATED';
    v_summary := format('Supervisor %s was updated.', new.name);
  end if;

  insert into valtrim.audit_events (
    module,
    action,
    result,
    actor_type,
    actor_user_id,
    actor_name,
    actor_email,
    actor_role,
    entity_type,
    entity_id,
    entity_label,
    summary,
    previous_values,
    new_values,
    metadata
  )
  values (
    'PEOPLE',
    v_action,
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, 'System'),
    v_actor_email,
    v_actor_role,
    'SUPERVISOR',
    new.id::text,
    new.name,
    v_summary,
    v_previous_values,
    v_new_values,
    jsonb_build_object(
      'supervisorEmail', new.email::text,
      'territory', new.territory,
      'role', 'SUPERVISOR',
      'isActive', new.is_active,
      'changedFields', to_jsonb(v_changed_fields)
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_supervisor_change()
  from public, anon, authenticated;

drop trigger if exists supervisors_audit on valtrim.people;
create trigger supervisors_audit
after update on valtrim.people
for each row execute function private.audit_supervisor_change();

commit;
