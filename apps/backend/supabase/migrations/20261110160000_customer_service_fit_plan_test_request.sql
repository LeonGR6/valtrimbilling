-- Customer Service proposal fit, blocks R3 and R4 (docs/customer-service-proposal-fit-plan.md).
-- User-authorized test data (10 Nov 2026): one Ready to propose request on time and near a
-- registered visit, so the final-days rule and the suggestions can be checked in the app.
-- - Property: lot TEST-8 in the same Job and point as CS-2497 (Harmony), so CS-2497 is Near.
-- - Request: 30 min, one person, medium priority, reported on Tue 10 Nov 2026, so the
--   trigger sets the due date (Tue 17 Nov with five business days). The classification
--   and reviewer are copied from CS-2497; the customer is fictitious (example.com).
-- Running it again does nothing once lot TEST-8 exists. To remove it, write a new migration.
begin;

do $fit_test$
declare
  v_template valtrim.service_requests%rowtype;
  v_property_id bigint;
  v_request_id bigint;
begin
  if exists (
    select 1 from valtrim.service_properties property
    join valtrim.service_properties template on template.id = 1501
    where property.job_id = template.job_id and property.lot_number = 'TEST-8'
  ) then
    raise notice 'The fit plan test request already exists; nothing was changed';
    return;
  end if;

  select * into strict v_template
  from valtrim.service_requests request
  where request.id = 1497 and request.folio = 'CS-2497';

  insert into valtrim.service_properties (
    community_id, lot_number, address, city, state, postal_code, plan_label,
    latitude, longitude, job_id, created_by, updated_by
  )
  select template.community_id, 'TEST-8', template.address, template.city, template.state,
    template.postal_code, template.plan_label, template.latitude, template.longitude,
    template.job_id, v_template.created_by, v_template.created_by
  from valtrim.service_properties template
  where template.id = v_template.property_id
  returning id into strict v_property_id;

  insert into valtrim.service_requests (
    property_id, reported_on, reported_on_source, created_by, updated_by, coordinator_user_id,
    homeowner_name, homeowner_email, priority, description, internal_notes,
    estimated_duration_minutes, customer_unavailable_dates, customer_needs_contact,
    workflow_stage, service_kind, work_category, service_task, crew_size,
    reviewed_at, reviewed_by, valtrim_items_confirmed
  ) values (
    v_property_id, date '2026-11-10', v_template.reported_on_source, v_template.created_by,
    v_template.created_by, v_template.coordinator_user_id,
    'Fit Test Customer', 'fit-test@example.com', 'MEDIUM', 'Adjust closet shelving',
    'Test request for the proposal fit plan (blocks R3 and R4). Safe to delete.',
    30, '{}', false,
    'READY_TO_PROPOSE', v_template.service_kind, v_template.work_category, v_template.service_task, 1,
    pg_catalog.now(), v_template.reviewed_by, true
  )
  returning id into strict v_request_id;

  insert into valtrim.service_request_items (
    request_id, item_number, description, material_required, chargeable, created_by, updated_by
  ) values (
    v_request_id, 1, 'Adjust closet shelving', false, false, v_template.created_by, v_template.created_by
  );
end;
$fit_test$;

commit;
