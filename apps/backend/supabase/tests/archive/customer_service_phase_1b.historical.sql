-- Historical route generator retired by 20261021141000. Its tables remain;
-- current scheduling is frontend-only. Retirement is covered by the cleanup suite.
begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

select has_table(
  'valtrim',
  'service_schedule_proposals',
  'Automatic route alternatives are persisted'
);

select has_table(
  'valtrim',
  'service_schedule_proposal_stops',
  'Each proposal persists its ordered jobs'
);

select has_view(
  'valtrim',
  'service_schedule_proposal_options',
  'The frontend has one proposal options view'
);

select has_type(
  'valtrim',
  'service_schedule_proposal_status',
  'Proposal lifecycle states are constrained by an enum'
);

select has_function(
  'valtrim',
  'generate_service_schedule_proposals',
  array['bigint', 'integer'],
  'Dispatchers have one automatic proposal RPC'
);

select has_function(
  'private',
  'generate_service_schedule_proposals_internal',
  array['bigint', 'integer'],
  'Proposal persistence stays in a private implementation'
);

select has_function(
  'private',
  'find_service_schedule_candidates',
  array['bigint'],
  'Candidate calculation stays private'
);

select has_function(
  'private',
  'service_distance_miles',
  array['numeric', 'numeric', 'numeric', 'numeric'],
  'Coordinate distance is calculated in the database'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid = 'valtrim.service_schedule_proposals'::regclass
  ),
  'Proposal headers have RLS enabled'
);

select ok(
  (
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid = 'valtrim.service_schedule_proposal_stops'::regclass
  ),
  'Proposal stops have RLS enabled'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.service_schedule_proposals',
    'select'
  ),
  'Authenticated dispatchers can read proposal headers subject to RLS'
);

select ok(
  has_table_privilege(
    'authenticated',
    'valtrim.service_schedule_proposal_stops',
    'select'
  ),
  'Authenticated dispatchers can read proposal stops subject to RLS'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_schedule_proposals',
    'insert'
  ),
  'Browser clients cannot insert proposal headers directly'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'valtrim.service_schedule_proposal_stops',
    'insert'
  ),
  'Browser clients cannot insert proposal stops directly'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_schedule_proposals_id_seq',
    'usage'
  ),
  'Only the proposal RPC allocates proposal identities'
);

select ok(
  not has_sequence_privilege(
    'authenticated',
    'valtrim.service_schedule_proposal_stops_id_seq',
    'usage'
  ),
  'Only the proposal RPC allocates stop identities'
);

select ok(
  not has_table_privilege(
    'anon',
    'valtrim.service_schedule_proposal_options',
    'select'
  ),
  'Anonymous users cannot read proposed routes'
);

select ok(
  has_function_privilege(
    'authenticated',
    'valtrim.generate_service_schedule_proposals(bigint,integer)',
    'execute'
  ),
  'Authenticated users can invoke generation subject to its role check'
);

select ok(
  not has_function_privilege(
    'anon',
    'valtrim.generate_service_schedule_proposals(bigint,integer)',
    'execute'
  ),
  'Anonymous users cannot generate proposals'
);

select ok(
  (
    select 'security_invoker=true' = any(view_record.reloptions)
    from pg_class view_record
    where view_record.oid =
      'valtrim.service_schedule_proposal_options'::regclass
  ),
  'The proposal view evaluates RLS as its caller'
);

select has_index(
  'valtrim',
  'service_schedule_proposals',
  'service_schedule_proposals_request_idx',
  'Request proposal lookups are indexed'
);

select has_index(
  'valtrim',
  'service_schedule_proposals',
  'service_schedule_proposals_technician_day_idx',
  'Technician day proposal lookups are indexed'
);

select has_index(
  'valtrim',
  'service_schedule_proposal_stops',
  'service_schedule_proposal_stops_request_idx',
  'Requests can find every proposal that contains them'
);

select has_trigger(
  'valtrim',
  'service_requests',
  'service_requests_supersede_proposals',
  'Request scheduling changes supersede stale proposals'
);

select has_trigger(
  'valtrim',
  'service_request_availability',
  'service_request_availability_supersede_proposals',
  'Availability changes supersede stale proposals'
);

select has_trigger(
  'valtrim',
  'service_properties',
  'service_properties_supersede_proposals',
  'Coordinate changes supersede stale proposals'
);

select has_trigger(
  'valtrim',
  'service_technician_profiles',
  'service_technician_profiles_supersede_proposals',
  'Technician workday changes supersede stale proposals'
);

select has_trigger(
  'valtrim',
  'service_appointments',
  'service_appointments_supersede_proposals',
  'Conflicting appointments supersede stale proposals'
);

select has_trigger(
  'valtrim',
  'service_scheduling_settings',
  'service_scheduling_settings_supersede_proposals',
  'Scheduling rule changes supersede stale proposals'
);

select ok(
  private.service_distance_miles(
    33.986588,
    -117.343021,
    33.986588,
    -117.343021
  ) = 0,
  'Identical coordinates have zero distance'
);

create temporary table phase_1b_fixture (
  target_request_id bigint not null,
  companion_request_id bigint not null,
  technician_id bigint not null,
  visit_day date not null
) on commit drop;

do $$
declare
  v_technician_id bigint;
  v_target_property_id bigint;
  v_companion_property_id bigint;
  v_target_request_id bigint;
  v_companion_request_id bigint;
  v_visit_day date := current_date + 1;
begin
  while extract(isodow from v_visit_day) not between 1 and 5 loop
    v_visit_day := v_visit_day + 1;
  end loop;

  update valtrim.service_scheduling_settings
  set time_zone = 'UTC',
      company_latitude = 33.986588,
      company_longitude = -117.343021,
      travel_buffer_minutes = 15
  where id = 1;

  insert into valtrim.people (name, email, phone, is_active)
  values ('Phase 1B Technician', null, null, true)
  returning id into v_technician_id;

  insert into valtrim.person_roles (person_id, role)
  values (v_technician_id, 'SERVICE_TECHNICIAN');

  insert into valtrim.service_technician_profiles (
    person_id,
    workday_starts_at,
    workday_ends_at,
    start_latitude,
    start_longitude
  ) values (
    v_technician_id,
    time '08:00',
    time '17:00',
    33.986588,
    -117.343021
  );

  insert into valtrim.service_properties (
    address,
    city,
    state,
    latitude,
    longitude
  ) values (
    '100 Proposal Test Street',
    'Riverside',
    'CA',
    33.986900,
    -117.343200
  ) returning id into v_target_property_id;

  insert into valtrim.service_properties (
    address,
    city,
    state,
    latitude,
    longitude
  ) values (
    '200 Nearby Test Street',
    'Riverside',
    'CA',
    33.996900,
    -117.353200
  ) returning id into v_companion_property_id;

  insert into valtrim.service_requests (
    property_id,
    reported_on,
    homeowner_name,
    homeowner_email,
    homeowner_phone,
    request_type,
    priority,
    description,
    work_type,
    estimated_duration_minutes
  ) values (
    v_target_property_id,
    current_date,
    'Proposal Target',
    'target@example.com',
    '+19515550101',
    'WARRANTY',
    'HIGH',
    'Target proposal test request',
    'HW',
    60
  ) returning id into v_target_request_id;

  insert into valtrim.service_requests (
    property_id,
    reported_on,
    homeowner_name,
    homeowner_email,
    homeowner_phone,
    request_type,
    priority,
    description,
    work_type,
    estimated_duration_minutes
  ) values (
    v_companion_property_id,
    current_date,
    'Proposal Companion',
    'companion@example.com',
    '+19515550102',
    'SERVICE_CALL',
    'MEDIUM',
    'Nearby proposal test request',
    'WS',
    60
  ) returning id into v_companion_request_id;

  insert into valtrim.service_request_availability (
    request_id,
    available_from,
    available_until
  ) values
    (
      v_target_request_id,
      (v_visit_day + time '09:00') at time zone 'UTC',
      (v_visit_day + time '16:00') at time zone 'UTC'
    ),
    (
      v_companion_request_id,
      (v_visit_day + time '09:00') at time zone 'UTC',
      (v_visit_day + time '16:00') at time zone 'UTC'
    );

  insert into phase_1b_fixture (
    target_request_id,
    companion_request_id,
    technician_id,
    visit_day
  ) values (
    v_target_request_id,
    v_companion_request_id,
    v_technician_id,
    v_visit_day
  );
end;
$$;

select ok(
  exists (
    select 1
    from phase_1b_fixture fixture
    cross join lateral private.find_service_schedule_candidates(
      fixture.target_request_id
    ) candidate
  ),
  'An eligible request receives at least one automatic candidate'
);

select ok(
  exists (
    select 1
    from phase_1b_fixture fixture
    cross join lateral private.find_service_schedule_candidates(
      fixture.target_request_id
    ) candidate
    where candidate.companion_request_id = fixture.companion_request_id
      and candidate.companion_distance_from_previous <= 10
  ),
  'The engine groups a compatible nearby request in the same route'
);

insert into valtrim.service_appointments (
  request_id,
  technician_id,
  starts_at,
  ends_at,
  state,
  is_current,
  notes
)
select
  fixture.companion_request_id,
  fixture.technician_id,
  (fixture.visit_day + time '09:00') at time zone 'UTC',
  (fixture.visit_day + time '10:00') at time zone 'UTC',
  'SCHEDULED',
  true,
  'Phase 1B occupied time fixture'
from phase_1b_fixture fixture;

select ok(
  exists (
    select 1
    from phase_1b_fixture fixture
    cross join lateral private.find_service_schedule_candidates(
      fixture.target_request_id
    ) candidate
  ),
  'The engine keeps looking after an occupied interval'
);

select ok(
  not exists (
    select 1
    from phase_1b_fixture fixture
    cross join lateral private.find_service_schedule_candidates(
      fixture.target_request_id
    ) candidate
    where candidate.technician_id = fixture.technician_id
      and candidate.target_starts_at
        < ((fixture.visit_day + time '10:15') at time zone 'UTC')
      and candidate.target_ends_at
        > ((fixture.visit_day + time '08:45') at time zone 'UTC')
  ),
  'Candidates exclude occupied appointment time plus the travel buffer'
);

select throws_ok(
  $$
    select valtrim.generate_service_schedule_proposals(1, 3)
  $$,
  '42501',
  'You do not have permission to manage Customer Service requests',
  'The generation RPC rejects callers without a scheduling role'
);

select * from finish();

rollback;
