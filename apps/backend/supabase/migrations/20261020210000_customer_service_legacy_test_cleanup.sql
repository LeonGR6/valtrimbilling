-- User-authorized permanent removal of the two legacy test requests, WITHOUT
-- backups. IDs, folios, versions and exclusive dependencies were inspected on
-- the linked project. This is not a general-purpose purge or a browser RPC.
begin;

do $cleanup$
declare
  v_request_ids constant bigint[] := array[3,4];
  v_proposal_ids constant bigint[] := array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
  v_scope record;
  v_hash text;
  v_before_hashes jsonb := '{}'::jsonb;
  v_deleted integer;
  -- Hashes are compared only in transaction memory, not exported or retained.
  v_scopes constant jsonb := jsonb_build_object(
    'valtrim.service_requests', 'id not in (3,4)',
    'valtrim.service_properties', 'id not in (3,4)',
    'valtrim.service_appointments', 'id not in (2,3)',
    'valtrim.service_schedule_proposals', 'id not in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21)',
    'valtrim.service_schedule_proposal_stops', 'proposal_id not in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21)',
    'valtrim.service_request_contacts', 'request_id not in (3,4)',
    'valtrim.service_request_items', 'request_id not in (3,4)',
    'valtrim.service_request_sources', 'request_id not in (3,4)',
    'valtrim.service_request_notes', 'request_id not in (3,4)',
    'valtrim.service_request_parts', 'request_id not in (3,4)',
    'valtrim.service_request_attachments', 'request_id not in (3,4)',
    'valtrim.service_request_availability', 'request_id not in (3,4)',
    'valtrim.service_request_status_history', 'request_id not in (3,4)',
    'valtrim.service_request_workflow_history', 'request_id not in (3,4)',
    'valtrim.service_communications', 'true',
    'private.service_confirmation_tokens', 'true',
    'valtrim.stored_files', 'true', 'storage.objects', 'true',
    'valtrim.jobs', 'true', 'valtrim.builders', 'true',
    'valtrim.people', 'true', 'valtrim.service_technician_profiles', 'true',
    'valtrim.audit_events', 'not (action = ''SERVICE_REQUEST_TEST_DATA_DELETED'' and metadata ->> ''migration'' = ''20261020210000'')'
  );
begin
  -- Lock parents before checking/deleting children. New FK references cannot
  -- slip in between the inventory checks and the delete.
  perform 1 from valtrim.service_requests where id = any(v_request_ids) order by id for update;
  if (select count(*) from valtrim.service_requests where id = any(v_request_ids)) <> 2 then
    raise exception 'Legacy cleanup requires both exact requests 3 and 4; nothing was deleted';
  end if;
  if exists (
    select 1 from valtrim.service_requests r where r.id = any(v_request_ids) and (
      r.folio <> case r.id when 3 then 'SR-00001003' else 'SR-00001004' end
      or r.property_id <> r.id or r.status <> 'CONTACT_NEEDED' or r.workflow_stage <> 'NEEDS_REVIEW'
      or r.updated_at <> timestamptz '2026-10-19 19:42:43.027093+00'
      or r.created_at <> case r.id when 3 then timestamptz '2026-09-28 13:53:15.930818+00'
        else timestamptz '2026-09-28 13:55:30.914681+00' end
    )
  ) then
    raise exception 'Legacy cleanup request identity or version changed; nothing was deleted';
  end if;
  perform 1 from valtrim.service_properties where id in (3,4) order by id for update;
  if (select count(*) from valtrim.service_properties where id in (3,4)) <> 2
     or exists(select 1 from valtrim.service_properties where id in (3,4) and (
       job_id is not null or updated_at <> case id when 3 then timestamptz '2026-09-28 13:53:15.930818+00'
         else timestamptz '2026-09-28 13:55:30.914681+00' end))
     or exists(select 1 from valtrim.service_requests where property_id in (3,4) and id not in (3,4)) then
    raise exception 'Legacy cleanup properties changed, have a Job or are shared; nothing was deleted';
  end if;

  perform 1 from valtrim.service_appointments where request_id = any(v_request_ids) order by id for update;
  if (select count(*) from valtrim.service_appointments where request_id = any(v_request_ids)) <> 2
     or exists(select 1 from valtrim.service_appointments where request_id = any(v_request_ids) and (
       not ((id = 2 and request_id = 4) or (id = 3 and request_id = 3))
       or updated_at <> timestamptz '2026-09-28 20:25:05.544297+00'
       or state <> 'SCHEDULED' or not is_current or approved_proposal_id is distinct from 19::bigint)) then
    raise exception 'Legacy cleanup appointments changed; nothing was deleted';
  end if;
  perform 1 from valtrim.service_schedule_proposals where id = any(v_proposal_ids) order by id for update;
  if (select count(*) from valtrim.service_schedule_proposals where id = any(v_proposal_ids)) <> 21
     or exists(select 1 from valtrim.service_schedule_proposals p where id = any(v_proposal_ids) and (
       requested_for_request_id <> 4 or generated_at >= timestamptz '2026-09-29 00:00:00+00'
       or status::text <> case when id <= 18 then 'SUPERSEDED' when id = 19 then 'APPROVED' else 'REJECTED' end
       or (select count(*) from valtrim.service_schedule_proposal_stops s where s.proposal_id = p.id) <> 2))
     or exists(select 1 from valtrim.service_schedule_proposal_stops
       where proposal_id = any(v_proposal_ids) and request_id not in (3,4))
     or exists(select 1 from valtrim.service_schedule_proposals p where not (id = any(v_proposal_ids)) and (
       requested_for_request_id = any(v_request_ids) or exists(select 1 from valtrim.service_schedule_proposal_stops s
         where s.proposal_id = p.id and s.request_id = any(v_request_ids))))
     or exists(select 1 from valtrim.service_appointments
       where approved_proposal_id = any(v_proposal_ids) and id not in (2,3)) then
    raise exception 'Legacy cleanup proposals changed or include other requests; nothing was deleted';
  end if;
  if exists(select 1 from valtrim.service_communications where request_id in (3,4) or appointment_id in (2,3))
     or exists(select 1 from private.service_confirmation_tokens where appointment_id in (2,3))
     or exists(select 1 from valtrim.service_request_parts where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_notes where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_contacts where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_items where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_sources where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_attachments where request_id in (3,4))
     or exists(select 1 from valtrim.service_request_workflow_history where request_id in (3,4))
     or (select count(*) from valtrim.service_request_availability where request_id in (3,4)) <> 2
     or (select count(*) from valtrim.service_request_status_history where request_id in (3,4)) <> 4
     or exists(select 1 from storage.objects where bucket_id = 'customer-service-sources'
       and name in ('requests/3/source.pdf','requests/4/source.pdf'))
     or exists(select 1 from valtrim.stored_files where bucket_id = 'customer-service-sources'
       and object_path in ('requests/3/source.pdf','requests/4/source.pdf')) then
    raise exception 'Legacy cleanup found unexpected dependencies or files; nothing was deleted';
  end if;

  for v_scope in select key, value from jsonb_each_text(v_scopes) loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text, ''[]'')) from %s t where %s',
      v_scope.key, v_scope.value) into v_hash;
    v_before_hashes := v_before_hashes || jsonb_build_object(v_scope.key, v_hash);
  end loop;

  delete from valtrim.service_appointments where id in (2,3) and request_id = any(v_request_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then raise exception 'Legacy cleanup appointment count mismatch'; end if;
  -- Stops cascade only from these 21 inspected proposal IDs. Removing proposals
  -- first also prevents availability-delete triggers from touching other plans.
  delete from valtrim.service_schedule_proposals where id = any(v_proposal_ids) and requested_for_request_id = 4;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 21 then raise exception 'Legacy cleanup proposal count mismatch'; end if;
  delete from valtrim.service_requests where id = any(v_request_ids);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then raise exception 'Legacy cleanup request count mismatch'; end if;
  delete from valtrim.service_properties p where id in (3,4)
    and not exists(select 1 from valtrim.service_requests r where r.property_id = p.id);
  get diagnostics v_deleted = row_count;
  if v_deleted <> 2 then raise exception 'Legacy cleanup property count mismatch'; end if;

  for v_scope in select key, value from jsonb_each_text(v_scopes) loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text, ''[]'')) from %s t where %s',
      v_scope.key, v_scope.value) into v_hash;
    if v_hash is distinct from v_before_hashes ->> v_scope.key then
      raise exception 'Legacy cleanup changed unrelated records in %; the transaction was rolled back', v_scope.key;
    end if;
  end loop;

  -- Append audit identities/counts only, never copies of request content.
  insert into valtrim.audit_events(module, action, actor_type, actor_name,
    entity_type, entity_id, entity_label, summary, metadata)
  select 'CUSTOMER_SERVICE', 'SERVICE_REQUEST_TEST_DATA_DELETED', 'SYSTEM', 'Authorized data cleanup',
    'SERVICE_REQUEST', id::text, folio, format('Legacy test request %s and its exclusive test dependencies were permanently deleted.', folio),
    jsonb_build_object('migration', '20261020210000', 'operation', 'cleanup_legacy_test_requests',
      'requestIds', to_jsonb(v_request_ids), 'appointmentIds', jsonb_build_array(2,3),
      'proposalIds', to_jsonb(v_proposal_ids), 'requestsDeleted', 2, 'propertiesDeleted', 2,
      'appointmentsDeleted', 2, 'proposalsDeleted', 21, 'stopsDeleted', 42,
      'availabilityDeleted', 2, 'statusHistoryDeleted', 4, 'filesDeleted', 0,
      'backupCreated', false, 'unrelatedRecordsVerified', true)
  from (values (3, 'SR-00001003'), (4, 'SR-00001004')) target(id, folio);
end;
$cleanup$;

commit;
