-- "Ready to submit" is no longer a Package status: a Package goes from Draft to
-- Awaiting payment as soon as it is submitted (emailed, printed to mail, or
-- downloaded for the Builder's portal), and from there to Paid / Closed.
--
-- The enum value stays (Postgres cannot drop one safely), but nothing uses it:
-- existing Packages in it go back to Draft and the status can no longer be set.

begin;

-- Packages already in the removed status return to Draft. The trigger that
-- guards Draft is paused only for this correction.
alter table valtrim.draw_packages disable trigger draw_packages_validate_workflow_status;

update valtrim.draw_packages
set workflow_status = 'DRAFT'
where workflow_status = 'READY_TO_SUBMIT';

alter table valtrim.draw_packages enable trigger draw_packages_validate_workflow_status;

create or replace function private.set_draw_package_workflow_status(
  p_package_id bigint,
  p_status valtrim.package_workflow_status
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_package_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Draw & Invoice Packages'
      using errcode = '42501';
  end if;
  if p_status is null or p_status = 'READY_TO_SUBMIT' then
    raise exception 'Select a valid Package status' using errcode = '23514';
  end if;
  update valtrim.draw_packages package
  set workflow_status = p_status,
      status_changed_at = now(),
      status_changed_by = v_actor_id,
      updated_by = v_actor_id
  where package.id = p_package_id and package.status <> 'VOIDED'
  returning package.id into v_package_id;
  if v_package_id is null then
    raise exception 'The Package is cancelled or no longer exists'
      using errcode = 'P0002';
  end if;
  return v_package_id;
end;
$$;

-- A Package that was submitted moves from Draft to Awaiting payment. One that
-- is already past Draft is left as it is, so submitting twice never moves a
-- Package backwards. Accounting can do this too: it is the one who submits.
create function private.mark_package_submitted_internal(p_package_id bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_status valtrim.package_workflow_status;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to submit Draw & Invoice Packages'
      using errcode = '42501';
  end if;

  select package.workflow_status
  into v_status
  from valtrim.draw_packages package
  where package.id = p_package_id and package.status <> 'VOIDED'
  for update;
  if not found then
    raise exception 'The Package is cancelled or no longer exists'
      using errcode = 'P0002';
  end if;

  if v_status in ('DRAFT', 'READY_TO_SUBMIT') then
    update valtrim.draw_packages
    set workflow_status = 'AWAITING_PAYMENT',
        status_changed_at = now(),
        status_changed_by = v_actor_id,
        updated_by = v_actor_id
    where id = p_package_id;
    v_status := 'AWAITING_PAYMENT';
  end if;

  return v_status::text;
end;
$$;

revoke all on function private.mark_package_submitted_internal(bigint)
  from public, anon, authenticated;
grant execute on function private.mark_package_submitted_internal(bigint)
  to authenticated;

create function valtrim.mark_package_submitted(p_package_id bigint)
returns text
language sql
security invoker
set search_path = ''
as $$
  select private.mark_package_submitted_internal(p_package_id);
$$;

revoke all on function valtrim.mark_package_submitted(bigint)
  from public, anon, authenticated;
grant execute on function valtrim.mark_package_submitted(bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
