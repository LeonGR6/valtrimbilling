-- User-authorized (6 Nov 2026), plan docs/jobs-and-customer-service-reset-plan.md, block 4.
-- Registers the real Jobs (one per community) with the coordinates the user
-- supplied (degrees West are stored as negative longitudes). A community
-- without coordinates gets no Job: Indigo (Melia Homes) is left out until it has
-- them. Supervisors and Jobsite Superintendents are the TEST records the user
-- approved. The billing setup version is chosen by jobs_validate (the builder's
-- ACTIVE version). The two kept email requests are linked to their Job and get
-- its coordinates; CS-2031 (Indigo) stays without a Job.
begin;

do $jobs$
declare
  v_count integer;
begin
  if exists (select 1 from valtrim.jobs) then
    raise exception 'Jobs already exist; run the reset first. Nothing was created';
  end if;

  select count(*) into v_count
  from valtrim.people person
  join (values (27, 'supervisor test'), (29, 'supervisor test two'), (30, 'supervisor test three'))
    expected(id, name) on expected.id = person.id and expected.name = person.name
  where person.is_active;
  if v_count <> 3 then
    raise exception 'TEST supervisors changed (% of 3 matched); nothing was created', v_count;
  end if;

  insert into valtrim.jobs (
    code, builder_id, supervisor_id, superintendent_id,
    status, is_active, community, community_latitude, community_longitude
  )
  select
    job.code, builder.id, job.supervisor_id,
    (select contact.id from valtrim.builder_contacts contact
     where contact.builder_id = builder.id and contact.type = 'JOBSITE_SUPERINTENDENT' and contact.is_active
     order by contact.id limit 1),
    'ACTIVE', true, job.community, job.latitude, job.longitude
  from (values
    ('PUL-PWL',  'PUL',  'Pickwick Lane',             34.16003,   -118.31180,   29),
    ('TPIE-LIN', 'TPIE', 'Linwood',                   33.94469,   -116.93452,   27),
    ('TPIE-ECH', 'TPIE', 'Echo Highlands',            33.66023,   -117.38831,   27),
    ('TPIE-HAR', 'TPIE', 'Harmony at CH Heights',     33.6553011, -117.2438015, 27),
    ('BR-MAG',   'BR',   'Magnolia at Arcadia',       34.11220,   -118.01009,   27),
    ('BR-DWL',   'BR',   'Sundance Park - Dwell',     33.99804,   -117.57210,   27),
    ('KBH-RMA',  'KBH',  'Rancho Madrina',            33.77674,   -116.99030,   29),
    ('CV-PAL1B', 'CV',   'Palmdale 1B - All Phases',  34.59579,   -118.19788,   30),
    ('TB-VPB',   'TB',   'Metro Heights-Viewpoint B', 34.02944,   -118.09022,   30),
    ('HVH-HILL', 'HVH',  'Hill',                      34.86589,   -118.19723,   29)
  ) as job(code, builder_code, community, latitude, longitude, supervisor_id)
  join valtrim.builders builder on builder.code = job.builder_code and builder.is_active;
  get diagnostics v_count = row_count;
  if v_count <> 10 then
    raise exception 'Job insert count mismatch (% of 10); check builder codes', v_count;
  end if;

  -- Link the kept email requests to their Job and copy the Job coordinates.
  update valtrim.service_properties property
  set job_id = job.id, latitude = job.community_latitude, longitude = job.community_longitude
  from (values (1024, 'TPIE-ECH', '33312 DAYSPRING COURT%'), (1025, 'TPIE-LIN', '5242 GUAVA LANE%'))
    link(property_id, job_code, address_pattern)
  join valtrim.jobs job on job.code = link.job_code
  where property.id = link.property_id
    and upper(property.address) like link.address_pattern
    and property.job_id is null;
  get diagnostics v_count = row_count;
  if v_count <> 2 then
    raise exception 'Request property link count mismatch (% of 2)', v_count;
  end if;
end;
$jobs$;

commit;
