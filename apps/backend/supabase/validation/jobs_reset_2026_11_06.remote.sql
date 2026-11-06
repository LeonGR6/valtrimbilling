-- Read-only check after applying 20261106150000, 20261106151000 and 20261106152000
-- (docs/jobs-and-customer-service-reset-plan.md). Expected: 10 Jobs, 3 requests
-- (CS-2022, CS-2023, CS-2031), 3 properties, 0 appointments, 3 new builders with
-- an ACTIVE TEST billing version and a TEST superintendent.
select 'job' as kind, job.code as key,
  builder.name || ' | ' || job.community || ' | ' || job.community_latitude || ', ' || job.community_longitude
    || ' | billing v' || version.version_number || ' ' || version.status as detail
from valtrim.jobs job
join valtrim.builders builder on builder.id = job.builder_id
join valtrim.billing_setup_versions version on version.id = job.billing_setup_version_id
union all
select 'request', request.folio,
  coalesce(job.code, 'no Job') || ' | ' || coalesce(property.latitude::text || ', ' || property.longitude::text, 'no coordinates')
from valtrim.service_requests request
join valtrim.service_properties property on property.id = request.property_id
left join valtrim.jobs job on job.id = property.job_id
union all
select 'builder', builder.code,
  builder.name || ' | active billing: ' || coalesce((select 'v' || version.version_number from valtrim.billing_setup_versions version
    where version.builder_id = builder.id and version.status = 'ACTIVE'), 'none')
  || ' | superintendents: ' || (select count(*) from valtrim.builder_contacts contact
    where contact.builder_id = builder.id and contact.type = 'JOBSITE_SUPERINTENDENT' and contact.is_active)
from valtrim.builders builder
union all
select 'count', 'appointments', count(*)::text from valtrim.service_appointments
union all
select 'count', 'properties', count(*)::text from valtrim.service_properties
order by 1, 2;
