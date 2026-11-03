begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select count(*) from valtrim.service_requests where id in (3,4)), 0::bigint, 'Only the two exact legacy request IDs are retired');
select is((select count(*) from valtrim.service_requests where folio in ('SR-00001003','SR-00001004')), 0::bigint, 'Legacy test folios are absent');
select is((select count(*) from valtrim.service_properties where id in (3,4)), 0::bigint, 'Exclusive legacy properties are removed');
select is((select count(*) from valtrim.service_appointments where id in (2,3) or request_id in (3,4)), 0::bigint, 'Exclusive test appointments are removed');
select is((select count(*) from valtrim.service_schedule_proposals where id in (1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21) or requested_for_request_id in (3,4)), 0::bigint, 'Only the inspected legacy proposals are retired');
select is((select count(*) from valtrim.service_schedule_proposal_stops where request_id in (3,4)), 0::bigint, 'No legacy proposal stops remain');
select is((select count(*) from valtrim.service_request_availability where request_id in (3,4)), 0::bigint, 'Legacy availability cascades are complete');
select is((select count(*) from valtrim.service_request_status_history where request_id in (3,4)), 0::bigint, 'Legacy request status history cascades are complete');
select is((select count(*) from valtrim.service_request_contacts where request_id in (3,4)), 0::bigint, 'No legacy contacts remain');
select is((select count(*) from valtrim.service_request_items where request_id in (3,4)), 0::bigint, 'No legacy items remain');
select is((select count(*) from valtrim.service_request_sources where request_id in (3,4)), 0::bigint, 'No legacy sources remain');
select is((select count(*) from valtrim.service_communications where request_id in (3,4) or appointment_id in (2,3)), 0::bigint, 'No communication references remain');
select is((select count(*) from private.service_confirmation_tokens where appointment_id in (2,3)), 0::bigint, 'No confirmation tokens remain');
select is((select count(*) from valtrim.audit_events where action = 'SERVICE_REQUEST_TEST_DATA_DELETED'
  and metadata ->> 'migration' = '20261020210000' and entity_id in ('3','4')), 2::bigint, 'Each removed request has a dedicated audit event');
select ok(not exists(select 1 from valtrim.audit_events where action = 'SERVICE_REQUEST_TEST_DATA_DELETED'
  and metadata ->> 'migration' = '20261020210000' and (
    entity_id not in ('3','4') or metadata ->> 'backupCreated' <> 'false'
    or metadata ->> 'unrelatedRecordsVerified' <> 'true' or previous_values <> '{}'::jsonb or new_values <> '{}'::jsonb)),
  'Cleanup audit contains identities/counts without backups or request contents');
select ok(not exists(select 1 from valtrim.service_requests r left join valtrim.service_properties p on p.id = r.property_id where p.id is null), 'Other requests retain valid properties');
select ok(not exists(select 1 from valtrim.service_appointments a left join valtrim.service_requests r on r.id = a.request_id where r.id is null), 'No appointment is orphaned');
select ok(not exists(select 1 from valtrim.service_schedule_proposal_stops s left join valtrim.service_requests r on r.id = s.request_id
  left join valtrim.service_schedule_proposals p on p.id = s.proposal_id where r.id is null or p.id is null), 'No proposal stop is orphaned');

select * from finish();
rollback;
