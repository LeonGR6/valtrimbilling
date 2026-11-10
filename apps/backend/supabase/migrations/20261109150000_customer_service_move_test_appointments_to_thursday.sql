-- Test data, user-authorized (9 Nov 2026): CS-2496 and CS-2497 are test requests whose
-- Monday 9 Nov appointments were completed automatically when their windows ended.
-- They move to Thursday 12 Nov with the same times and technician, so the planner can be
-- tested with future appointments (traffic-aware travel needs a future departure time).
--
-- - CS-2497 no longer lists Thursday 12 Nov as unavailable (test value; Wednesday stays).
-- - Both appointments go back to SCHEDULED and both requests back to CONFIRMED, the stage
--   they had before the automatic WORKING/COMPLETED transitions.
-- - The change is attributed to the system (valtrim.system_actor), like the transitions.
-- - Saved travel estimates are kept: the planner marks them for recalculation.
begin;

select pg_catalog.set_config('valtrim.system_actor', 'on', true);

do $move$
declare
  v_count integer;
begin
  update valtrim.service_requests
  set customer_unavailable_dates = array['2026-11-11']::date[], updated_by = null
  where folio = 'CS-2497' and customer_unavailable_dates = array['2026-11-11', '2026-11-12']::date[];
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CS-2497 unavailable dates changed since 9 Nov; nothing was changed';
  end if;

  update valtrim.service_appointments appointment
  set state = 'SCHEDULED',
      completed_at = null,
      window_starts_at = (date '2026-11-12' + (appointment.window_starts_at at time zone 'America/Los_Angeles')::time) at time zone 'America/Los_Angeles',
      window_ends_at = (date '2026-11-12' + (appointment.window_ends_at at time zone 'America/Los_Angeles')::time) at time zone 'America/Los_Angeles',
      starts_at = (date '2026-11-12' + (appointment.starts_at at time zone 'America/Los_Angeles')::time) at time zone 'America/Los_Angeles',
      ends_at = (date '2026-11-12' + (appointment.ends_at at time zone 'America/Los_Angeles')::time) at time zone 'America/Los_Angeles',
      updated_by = null
  from valtrim.service_requests request
  where request.id = appointment.request_id
    and request.folio in ('CS-2496', 'CS-2497')
    and appointment.is_current
    and appointment.state = 'COMPLETED'
    and (appointment.window_starts_at at time zone 'America/Los_Angeles')::date = date '2026-11-09';
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'Expected 2 completed Monday appointments for CS-2496/CS-2497, found %; nothing was changed', v_count;
  end if;

  update valtrim.service_requests
  set workflow_stage = 'CONFIRMED', completed_at = null, updated_by = null
  where folio in ('CS-2496', 'CS-2497') and workflow_stage = 'COMPLETED' and resolution_status is null;
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'Expected CS-2496 and CS-2497 to be COMPLETED, found %; nothing was changed', v_count;
  end if;
end;
$move$;

select pg_catalog.set_config('valtrim.system_actor', '', true);

commit;
