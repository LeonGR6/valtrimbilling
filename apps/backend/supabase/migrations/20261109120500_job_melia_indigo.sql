-- User-authorized (9 Nov 2026). Registers the Indigo Job (Melia Homes, Azure Way,
-- Hawthorne) now that its coordinates are known, and links the kept email request
-- CS-2031 (12720 Azure Way, Unit 33) to it with the Job coordinates. Supervisor and
-- Jobsite Superintendent are the approved TEST records; jobs_validate selects the
-- builder's ACTIVE billing setup version.
begin;

do $indigo$
declare
  v_job_id bigint;
  v_count integer;
begin
  if exists (select 1 from valtrim.jobs where code = 'MH-IND') then
    raise exception 'MH-IND already exists; nothing was created';
  end if;
  if not exists (
    select 1 from valtrim.people where id = 30 and name = 'supervisor test three' and is_active
  ) then
    raise exception 'TEST supervisor 30 changed; nothing was created';
  end if;

  insert into valtrim.jobs (
    code, builder_id, supervisor_id, superintendent_id,
    status, is_active, community, community_latitude, community_longitude
  )
  select 'MH-IND', builder.id, 30,
    (select contact.id from valtrim.builder_contacts contact
     where contact.builder_id = builder.id and contact.type = 'JOBSITE_SUPERINTENDENT' and contact.is_active
     order by contact.id limit 1),
    'ACTIVE', true, 'Indigo', 33.916783554215854, -118.35494806466254
  from valtrim.builders builder
  where builder.code = 'MH' and builder.is_active
  returning id into v_job_id;
  if v_job_id is null then
    raise exception 'Melia Homes (MH) is not an active builder; nothing was created';
  end if;

  update valtrim.service_properties property
  set job_id = v_job_id, latitude = 33.916783554215854, longitude = -118.35494806466254
  from valtrim.service_requests request
  where request.property_id = property.id
    and request.id = 1031 and request.folio = 'CS-2031'
    and upper(property.address) like '12720 AZURE WAY%'
    and property.job_id is null;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'CS-2031 property link count mismatch (% of 1)', v_count;
  end if;
end;
$indigo$;

commit;
