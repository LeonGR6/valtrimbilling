-- Customer Service test data authorized by the user (12 Nov 2026): two requests in Orange
-- County with a registered visit on Monday 16 Nov 2026, so the Monday agenda, the delay
-- margins and the day-before traffic check (Friday afternoon) can be checked in the app.
-- - Properties: lots TEST-9 (Newport Beach) and TEST-10 (Huntington Beach) in the test Job of
--   CS-2497 (Harmony), each with the coordinates the user gave. Travel uses the property
--   coordinates, so the two lots are about 3.4 miles apart in a straight line.
-- - Requests: 30 min, one person, medium priority, reported on Thu 12 Nov 2026, so the
--   trigger sets the due date (Thu 19 Nov with five business days), not Monday. The
--   classification and reviewer are copied from CS-2497; the customers are fictitious
--   (example.com).
-- - Visits: Jorge Murillo on Monday 16 Nov, both in the 8:00-10:00 window: TEST-9 works
--   8:00-8:30 and TEST-10 9:00-9:30, with a manual travel estimate of 15 minutes between
--   them. They go through register_customer_service_appointment, the function the
--   customer-service-appointments Edge Function calls, so the CONFIRMED stage, the audit and
--   the MANUAL travel row match a registration from the planner. The day-before check
--   compares those 15 minutes with Google (decision P5).
-- Running it again does nothing once lot TEST-9 exists. To remove it, write a new migration.
begin;

do $monday_test$
declare
  v_template valtrim.service_requests%rowtype;
  v_job_id bigint;
  v_actor_id uuid;
  v_technician_id bigint;
  v_time_zone text;
  v_lot record;
  v_property_id bigint;
  v_request_id bigint;
  v_previous_request_id bigint;
  v_updated_at timestamptz;
  v_expected_ids bigint[];
begin
  select property.job_id into strict v_job_id
  from valtrim.service_properties property where property.id = 1501;

  if exists (
    select 1 from valtrim.service_properties property
    where property.job_id = v_job_id and property.lot_number = 'TEST-9'
  ) then
    raise notice 'The Monday test visits already exist; nothing was changed';
    return;
  end if;

  select * into strict v_template
  from valtrim.service_requests request
  where request.id = 1497 and request.folio = 'CS-2497';

  -- The ADMIN who registered the Thursday test visits registers these too.
  select app_user.id into strict v_actor_id
  from valtrim.app_users app_user
  where app_user.id = (
      select appointment.created_by from valtrim.service_appointments appointment
      where appointment.request_id = 1497 order by appointment.id limit 1
    )
    and app_user.is_active and app_user.role::text in ('ADMIN', 'SCHEDULING');

  select roster.id into strict v_technician_id
  from valtrim.service_technician_roster roster
  where roster.name = 'Jorge Murillo' and roster.is_active;

  select settings.time_zone into strict v_time_zone
  from valtrim.service_scheduling_settings settings where settings.id = 1;

  for v_lot in
    select *
    from (values
      (1, 'TEST-9', '300 Test Way, Newport Beach, CA', 33.63717377010304, -117.89873154408701,
        'Monday Test Customer A', 'monday-test-a@example.com', 'Adjust closet shelving', time '08:00'),
      (2, 'TEST-10', '400 Test Way, Huntington Beach, CA', 33.656880280531404, -117.95345779186414,
        'Monday Test Customer B', 'monday-test-b@example.com', 'Replace door stop', time '09:00')
    ) lot(position, lot_number, address, latitude, longitude, customer_name, customer_email,
      description, work_start)
    order by position
  loop
    insert into valtrim.service_properties (
      lot_number, address, latitude, longitude, job_id, created_by, updated_by
    ) values (
      v_lot.lot_number, v_lot.address, v_lot.latitude, v_lot.longitude, v_job_id,
      v_template.created_by, v_template.created_by
    )
    returning id into strict v_property_id;

    insert into valtrim.service_requests (
      property_id, reported_on, reported_on_source, created_by, updated_by, coordinator_user_id,
      homeowner_name, homeowner_email, priority, description, internal_notes,
      estimated_duration_minutes, customer_unavailable_dates, customer_needs_contact,
      workflow_stage, service_kind, work_category, service_task, crew_size,
      reviewed_at, reviewed_by, valtrim_items_confirmed
    ) values (
      v_property_id, date '2026-11-12', v_template.reported_on_source, v_template.created_by,
      v_template.created_by, v_template.coordinator_user_id,
      v_lot.customer_name, v_lot.customer_email, 'MEDIUM', v_lot.description,
      'Test request with a Monday 16 Nov visit (day-before traffic check). Safe to delete.',
      30, '{}', false,
      'READY_TO_PROPOSE', v_template.service_kind, v_template.work_category, v_template.service_task, 1,
      pg_catalog.now(), v_template.reviewed_by, true
    )
    returning id, updated_at into strict v_request_id, v_updated_at;

    insert into valtrim.service_request_items (
      request_id, item_number, description, material_required, chargeable, created_by, updated_by
    ) values (
      v_request_id, 1, v_lot.description, false, false, v_template.created_by, v_template.created_by
    );

    select coalesce(array_agg(appointment.id order by appointment.id), '{}'::bigint[])
    into v_expected_ids
    from valtrim.service_appointments appointment
    where appointment.is_current
      and appointment.technician_ids && array[v_technician_id]
      and (appointment.window_starts_at at time zone v_time_zone)::date = date '2026-11-16';

    perform valtrim.register_customer_service_appointment(
      v_actor_id,
      v_request_id,
      v_updated_at,
      v_expected_ids,
      jsonb_build_object(
        'technicianIds', jsonb_build_array(v_technician_id),
        'windowStartsAt', (timestamp '2026-11-16 08:00' at time zone v_time_zone),
        'windowEndsAt', (timestamp '2026-11-16 10:00' at time zone v_time_zone),
        'startsAt', ((date '2026-11-16' + v_lot.work_start) at time zone v_time_zone),
        'endsAt', ((date '2026-11-16' + v_lot.work_start + interval '30 minutes') at time zone v_time_zone),
        'pickupMinutes', 10,
        'acceptance', 'CUSTOMER_ACCEPTED_PROPOSAL'
      ),
      case when v_previous_request_id is null then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'fromRequestId', v_previous_request_id, 'toRequestId', v_request_id, 'minutes', 15
        ))
      end
    );

    v_previous_request_id := v_request_id;
  end loop;
end;
$monday_test$;

commit;
