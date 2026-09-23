begin;

-- Phase 3: persist builder-side contacts and audit every successful mutation.
-- All active users need these records for Jobs and Calendar, while only the
-- catalog managers may change them. Contacts are retired with is_active so
-- historical Job references are never broken by a browser hard delete.
grant select on valtrim.builder_contacts to authenticated;
grant insert (
  builder_id,
  name,
  type,
  email,
  phone,
  office_phone,
  notes,
  is_active
) on valtrim.builder_contacts to authenticated;
grant update (
  builder_id,
  name,
  type,
  email,
  phone,
  office_phone,
  notes,
  is_active
) on valtrim.builder_contacts to authenticated;

grant usage on sequence valtrim.builder_contacts_id_seq to authenticated;

create policy builder_contacts_select
on valtrim.builder_contacts for select to authenticated
using ((select private.is_active_user()));

create policy builder_contacts_insert
on valtrim.builder_contacts for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create policy builder_contacts_update
on valtrim.builder_contacts for update to authenticated
using ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')))
with check ((select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')));

create index builder_contacts_created_by_idx
  on valtrim.builder_contacts (created_by)
  where created_by is not null;

create index builder_contacts_updated_by_idx
  on valtrim.builder_contacts (updated_by)
  where updated_by is not null;

create or replace function private.audit_builder_contact_change()
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
  v_builder_name text;
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

  select builder.name
  into v_builder_name
  from valtrim.builders builder
  where builder.id = new.builder_id;

  v_new_snapshot := jsonb_build_object(
    'name', new.name,
    'builder', v_builder_name,
    'contact_type', new.type::text,
    'email', new.email::text,
    'phone', new.phone::text,
    'office_phone', new.office_phone::text,
    'is_active', new.is_active
  );

  if tg_op = 'INSERT' then
    v_action := 'BUILDER_CONTACT_CREATED';
    v_new_values := v_new_snapshot;
    v_changed_fields := array[
      'name',
      'builder',
      'contact_type',
      'email',
      'phone',
      'office_phone',
      'is_active'
    ];

    if new.notes is not null and btrim(new.notes) <> '' then
      v_changed_fields := array_append(v_changed_fields, 'notes');
    end if;

    v_summary := format(
      '%s was added as a builder contact for %s.',
      new.name,
      coalesce(v_builder_name, 'an unknown builder')
    );
  else
    select builder.name
    into v_builder_name
    from valtrim.builders builder
    where builder.id = new.builder_id;

    v_old_snapshot := jsonb_build_object(
      'name', old.name,
      'builder', (
        select builder.name
        from valtrim.builders builder
        where builder.id = old.builder_id
      ),
      'contact_type', old.type::text,
      'email', old.email::text,
      'phone', old.phone::text,
      'office_phone', old.office_phone::text,
      'is_active', old.is_active
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

    if old.notes is distinct from new.notes then
      v_changed_fields := array_append(v_changed_fields, 'notes');
    end if;

    -- Saving an unchanged form still issues an UPDATE and refreshes updated_at,
    -- but it is not meaningful business activity for the history screen.
    if cardinality(v_changed_fields) = 0 then
      return new;
    end if;

    if old.is_active and not new.is_active then
      v_action := 'BUILDER_CONTACT_DEACTIVATED';
      v_summary := format(
        '%s was deactivated as a builder contact for %s.',
        new.name,
        coalesce(v_builder_name, 'an unknown builder')
      );
    elsif not old.is_active and new.is_active then
      v_action := 'BUILDER_CONTACT_REACTIVATED';
      v_summary := format(
        '%s was reactivated as a builder contact for %s.',
        new.name,
        coalesce(v_builder_name, 'an unknown builder')
      );
    else
      v_action := 'BUILDER_CONTACT_UPDATED';
      v_summary := format(
        '%s''s builder contact information for %s was updated.',
        new.name,
        coalesce(v_builder_name, 'an unknown builder')
      );
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
    'BUILDER_CONTACTS',
    v_action,
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id,
    coalesce(v_actor_name, 'System'),
    v_actor_email,
    v_actor_role,
    'BUILDER_CONTACT',
    new.id::text,
    new.name,
    v_summary,
    v_previous_values,
    v_new_values,
    jsonb_build_object(
      'builderId', new.builder_id,
      'builderName', v_builder_name,
      'contactType', new.type::text,
      'changedFields', to_jsonb(v_changed_fields),
      'notesChanged', case
        when tg_op = 'INSERT' then new.notes is not null and btrim(new.notes) <> ''
        else old.notes is distinct from new.notes
      end
    )
  );

  return new;
end;
$$;

revoke all on function private.audit_builder_contact_change()
  from public, anon, authenticated;

create trigger builder_contacts_audit
after insert or update on valtrim.builder_contacts
for each row execute function private.audit_builder_contact_change();

notify pgrst, 'reload schema';

commit;
