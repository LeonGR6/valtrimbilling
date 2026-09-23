-- Phase 11: remove complete Production activities from the active Calendar.
--
-- Deletion is intentionally a soft cancellation. The activity and every
-- related stage, schedule, Lot and date-history row remain persisted for
-- audit, while the active Calendar query stops projecting the group.

begin;

create function private.cancel_production_activity(
  p_activity_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_activity_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role(
       'ADMIN',
       'PROJECT_MANAGEMENT',
       'SCHEDULING'
     )) then
    raise exception 'You do not have permission to delete Production calendar activities'
      using errcode = '42501';
  end if;

  if p_activity_id is null or p_activity_id <= 0 then
    raise exception 'Select a valid Production activity'
      using errcode = '23514';
  end if;

  update valtrim.production_activities activity
  set status = 'CANCELLED'::valtrim.production_activity_status,
      completed_at = null,
      cancelled_at = now(),
      updated_by = v_actor_id
  where activity.id = p_activity_id
    and activity.status = 'ACTIVE'::valtrim.production_activity_status
  returning activity.id into v_activity_id;

  if v_activity_id is null then
    raise exception 'The Production activity is no longer active'
      using errcode = 'P0002';
  end if;

  return v_activity_id;
end;
$$;

create function valtrim.cancel_production_activity(
  p_activity_id bigint
)
returns bigint
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_production_activity(p_activity_id);
$$;

revoke execute on function private.cancel_production_activity(bigint)
  from public, anon, authenticated;
revoke execute on function valtrim.cancel_production_activity(bigint)
  from public, anon, authenticated;

grant execute on function private.cancel_production_activity(bigint)
  to authenticated, service_role;
grant execute on function valtrim.cancel_production_activity(bigint)
  to authenticated, service_role;

comment on function valtrim.cancel_production_activity(bigint) is
  'Soft-cancels one complete Production calendar group while retaining its schedules and audit history. ADMIN, PROJECT_MANAGEMENT and SCHEDULING only.';

-- Direct DELETE stays unavailable. Customer Service and Extra / Change Orders
-- remain outside this phase and receive no grants, policies or functions.
notify pgrst, 'reload schema';

commit;
