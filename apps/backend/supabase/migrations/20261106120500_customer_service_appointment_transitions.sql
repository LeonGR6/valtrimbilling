-- Automatic appointment transitions (approved 5 Nov 2026): WORKING when the
-- customer window starts, COMPLETED when it ends, for every appointment of that
-- window. COMPLETED means the window ended, not that the work was verified.
--
-- The rule lives in the Edge Function customer-service-appointment-transitions
-- (functions/_shared/customerServiceAppointmentTransitions.ts). This migration
-- adds the forward-only writer it calls, attributes those changes to the system
-- in the audit and stage history, and schedules the function every minute.
begin;

-- 1. System attribution. The audit and stage-history triggers resolve the actor
-- as coalesce(auth.uid(), updated_by, created_by), so a clock-driven change would
-- be credited to whoever registered the appointment. The transition RPC sets the
-- transaction-local flag valtrim.system_actor; with it the triggers record no
-- user (actor_type SYSTEM). Browsers cannot set it: they have no SQL access and
-- set_config is not exposed through PostgREST.
do $patch$
declare
  v_function regprocedure;
  v_definition text;
  v_patched text;
begin
  foreach v_function in array array[
    'private.audit_service_appointment_change()'::regprocedure,
    'private.audit_customer_service_request_change()'::regprocedure,
    'valtrim.record_service_request_workflow_stage_change()'::regprocedure
  ] loop
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_patched := regexp_replace(
      v_definition,
      'coalesce\(\s*\(select auth\.uid\(\)\),\s*new\.updated_by,\s*new\.created_by\s*\)',
      $replacement$case when coalesce(current_setting('valtrim.system_actor', true), '') = 'on' then null else coalesce((select auth.uid()), new.updated_by, new.created_by) end$replacement$
    );
    if v_patched = v_definition then
      raise exception 'Actor expression not found in %; nothing was changed', v_function;
    end if;
    execute v_patched;
  end loop;
end;
$patch$;

-- 2. Forward-only writer. The Edge Function decides what is due; this re-checks
-- every item against the database clock and skips anything that no longer
-- applies (cancelled, already moved, window not reached).
create function valtrim.apply_customer_service_appointment_transitions(p_transitions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_appointment valtrim.service_appointments%rowtype;
  v_working integer := 0;
  v_completed integer := 0;
  v_skipped integer := 0;
begin
  if p_transitions is null or jsonb_typeof(p_transitions) <> 'array' then
    raise exception 'Transitions must be an array' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('valtrim.system_actor', 'on', true);

  for v_item in select value from jsonb_array_elements(p_transitions) loop
    select * into v_appointment
    from valtrim.service_appointments
    where id = (v_item ->> 'appointmentId')::bigint
    for update;

    if not found or not v_appointment.is_current or v_appointment.state <> 'SCHEDULED' then
      v_skipped := v_skipped + 1;
    elsif v_item ->> 'to' = 'COMPLETED' and v_appointment.window_ends_at <= pg_catalog.now() then
      update valtrim.service_appointments
      set state = 'COMPLETED', completed_at = v_appointment.window_ends_at, updated_by = null
      where id = v_appointment.id;
      update valtrim.service_requests
      set workflow_stage = 'COMPLETED', completed_at = v_appointment.window_ends_at, updated_by = null
      where id = v_appointment.request_id and workflow_stage in ('CONFIRMED', 'WORKING');
      v_completed := v_completed + 1;
    elsif v_item ->> 'to' = 'WORKING'
      and v_appointment.window_starts_at <= pg_catalog.now()
      and v_appointment.window_ends_at > pg_catalog.now() then
      update valtrim.service_requests
      set workflow_stage = 'WORKING', updated_by = null
      where id = v_appointment.request_id and workflow_stage = 'CONFIRMED';
      if found then v_working := v_working + 1; else v_skipped := v_skipped + 1; end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  perform pg_catalog.set_config('valtrim.system_actor', '', true);
  return jsonb_build_object('working', v_working, 'completed', v_completed, 'skipped', v_skipped);
end;
$function$;

revoke all on function valtrim.apply_customer_service_appointment_transitions(jsonb)
  from public, anon, authenticated;
grant execute on function valtrim.apply_customer_service_appointment_transitions(jsonb)
  to service_role;
comment on function valtrim.apply_customer_service_appointment_transitions(jsonb) is
  'Service role only (Edge Function customer-service-appointment-transitions). Applies due WORKING/COMPLETED transitions forward-only, attributed to the system.';

-- 3. Cancelling during the window: the request may already be WORKING. It goes
-- back to READY_TO_PROPOSE like a CONFIRMED one, so it never stays WORKING
-- without an appointment. Otherwise unchanged from 20261105120000.
create or replace function valtrim.cancel_customer_service_appointment(
  p_appointment_id bigint,
  p_expected_updated_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := private.require_customer_service_actor();
  v_appointment valtrim.service_appointments%rowtype;
  v_time_zone text;
  v_day date;
  v_technician_id bigint;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'Enter a cancellation reason of 500 characters or fewer' using errcode = '22023';
  end if;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id;
  if not found then
    raise exception 'The appointment was not found' using errcode = 'P0002';
  end if;
  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;
  v_day := (v_appointment.window_starts_at at time zone v_time_zone)::date;
  foreach v_technician_id in array (
    select array_agg(technician_id order by technician_id) from unnest(v_appointment.technician_ids) technician_id
  ) loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(format('service-appointments:%s:%s', v_technician_id, v_day), 0)
    );
  end loop;

  select * into v_appointment from valtrim.service_appointments where id = p_appointment_id for update;
  if p_expected_updated_at is null or v_appointment.updated_at is distinct from p_expected_updated_at then
    raise exception 'This appointment changed after you opened it. Reload and try again.' using errcode = '40001';
  end if;
  if not v_appointment.is_current or v_appointment.state <> 'SCHEDULED' then
    raise exception 'Only a scheduled appointment can be cancelled' using errcode = '55000';
  end if;

  update valtrim.service_appointments
  set state = 'CANCELLED', cancelled_at = pg_catalog.now(), is_current = false,
      cancel_reason = v_reason
  where id = p_appointment_id;

  update valtrim.service_requests
  set workflow_stage = 'READY_TO_PROPOSE'
  where id = v_appointment.request_id and workflow_stage in ('CONFIRMED', 'WORKING');

  return jsonb_build_object('appointmentId', p_appointment_id, 'requestId', v_appointment.request_id);
end;
$function$;

-- 4. Every minute. The project URL is the one already configured for the
-- Customer Service email automation. Run details of this job are kept one day.
select cron.schedule(
  'customer-service-appointment-transitions',
  '* * * * *',
  $cron$
    select net.http_post(
      url := (select automation.project_url from private.customer_service_email_automation automation where automation.singleton)
        || '/functions/v1/customer-service-appointment-transitions',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
    delete from cron.job_run_details
    where jobid = (select jobid from cron.job where jobname = 'customer-service-appointment-transitions')
      and end_time < now() - interval '1 day';
  $cron$
);

notify pgrst, 'reload schema';

commit;
