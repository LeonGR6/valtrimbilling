-- User-authorized (6 Nov 2026), plan docs/jobs-and-customer-service-reset-plan.md, block 1.
-- Removes every Job (all ten are test Jobs with made-up coordinates) and the
-- Customer Service records created by hand for testing. The three requests that
-- arrived by email (CS-2022, CS-2023, CS-2031) are kept; CS-2031 loses its link
-- to the test Indigo Job and its made-up coordinates. Builders, contacts,
-- billing setups, supervisors, technicians, scheduling settings and the email
-- connection are not touched. A backup of the affected rows was exported before
-- this migration. Storage files are removed afterwards with the Storage API.
begin;

do $reset$
declare
  v_count integer;
begin
  perform 1 from valtrim.jobs order by id for update;
  perform 1 from valtrim.service_requests where id in (55, 64, 288, 1300, 1301, 1022, 1023, 1031)
    order by id for update;

  -- Nothing financial may depend on the Jobs.
  if exists (select 1 from valtrim.plans) or exists (select 1 from valtrim.phases)
     or exists (select 1 from valtrim.lots) or exists (select 1 from valtrim.draw_packages) then
    raise exception 'Plans, phases, lots or draw packages exist; nothing was deleted';
  end if;

  -- The test requests to delete, by id, folio and created-by-hand origin.
  select count(*) into v_count
  from valtrim.service_requests request
  join (values
    (55, 'CS-1055'), (64, 'CS-1064'), (288, 'CS-1288'), (1300, 'CS-2300'), (1301, 'CS-2301')
  ) expected(id, folio) on expected.id = request.id and expected.folio = request.folio
  where request.email_import_id is null;
  if v_count <> 5 then
    raise exception 'Test request identity changed (% of 5 matched); nothing was deleted', v_count;
  end if;

  -- The email requests to keep, with their properties.
  select count(*) into v_count
  from valtrim.service_requests request
  join (values
    (1022, 'CS-2022', 1024), (1023, 'CS-2023', 1025), (1031, 'CS-2031', 1033)
  ) expected(id, folio, property_id)
    on expected.id = request.id and expected.folio = request.folio and expected.property_id = request.property_id
  where request.email_import_id is not null;
  if v_count <> 3 then
    raise exception 'Email request identity changed (% of 3 matched); nothing was deleted', v_count;
  end if;

  -- Any other request (for example a new email) would be left pointing at a
  -- property this migration deletes; stop instead.
  if exists (
    select 1 from valtrim.service_requests
    where id not in (55, 64, 288, 1300, 1301, 1022, 1023, 1031)
  ) then
    raise exception 'Unexpected Customer Service requests exist; nothing was deleted';
  end if;

  -- 1.1 Appointments of the test requests.
  delete from valtrim.service_appointments where request_id in (55, 64, 288, 1300, 1301);
  get diagnostics v_count = row_count;
  if v_count <> 3 then
    raise exception 'Appointment delete count mismatch (% of 3)', v_count;
  end if;

  -- 1.2 Sources first, then the file records they used (restrict FK).
  delete from valtrim.service_request_sources where request_id in (55, 64, 1300, 1301);
  get diagnostics v_count = row_count;
  if v_count <> 4 then
    raise exception 'Source delete count mismatch (% of 4)', v_count;
  end if;
  delete from valtrim.stored_files
  where id in (3, 8) and bucket_id = 'customer-service-sources'
    and object_path in ('requests/55/source.pdf', 'requests/64/source.pdf');
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'Stored file delete count mismatch (% of 2)', v_count;
  end if;

  -- 1.3 The test requests. Contacts, items, availability, history and travel
  -- estimates cascade.
  delete from valtrim.service_requests where id in (55, 64, 288, 1300, 1301);
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'Request delete count mismatch (% of 5)', v_count;
  end if;

  -- 1.4 Every property except those of the kept email requests.
  delete from valtrim.service_properties where id not in (1024, 1025, 1033);
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'Property delete count mismatch (% of 8)', v_count;
  end if;

  -- 1.5 CS-2031 keeps its address but loses the test Job and its coordinates.
  update valtrim.service_properties
  set job_id = null, latitude = null, longitude = null
  where id = 1033;

  if exists (select 1 from valtrim.service_properties where job_id is not null) then
    raise exception 'A property still references a Job; nothing was deleted';
  end if;

  -- 1.6 Every Job.
  delete from valtrim.jobs;
  get diagnostics v_count = row_count;
  if v_count <> 10 then
    raise exception 'Job delete count mismatch (% of 10)', v_count;
  end if;

  -- 1.7 Identities only, never copies of customer data.
  insert into valtrim.audit_events (
    module, action, actor_type, actor_name,
    entity_type, entity_id, entity_label, summary, metadata
  ) values
  (
    'JOBS', 'JOB_TEST_DATA_DELETED', 'SYSTEM', 'Authorized data cleanup',
    'JOB', '12-21', 'All test Jobs',
    'The ten test Jobs (ids 12-21) were permanently deleted before registering the real Jobs.',
    jsonb_build_object('migration', '20261106150000', 'operation', 'reset_test_jobs',
      'jobIds', jsonb_build_array(12, 13, 14, 15, 16, 17, 18, 19, 20, 21), 'backupCreated', true)
  ),
  (
    'CUSTOMER_SERVICE', 'SERVICE_REQUEST_TEST_DATA_DELETED', 'SYSTEM', 'Authorized data cleanup',
    'SERVICE_REQUEST', '55,64,288,1300,1301', 'CS-1055, CS-1064, CS-1288, CS-2300, CS-2301',
    'Five manually created test requests, their appointments, sources and properties were permanently deleted. CS-2022, CS-2023 and CS-2031 were kept.',
    jsonb_build_object('migration', '20261106150000', 'operation', 'reset_test_requests',
      'deletedFolios', jsonb_build_array('CS-1055', 'CS-1064', 'CS-1288', 'CS-2300', 'CS-2301'),
      'keptFolios', jsonb_build_array('CS-2022', 'CS-2023', 'CS-2031'), 'backupCreated', true)
  );
end;
$reset$;

commit;
