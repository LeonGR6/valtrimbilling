begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

select ok(
  (
    select column_default::text like '%CS-%'
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'service_requests'
      and column_name = 'folio'
  ),
  'Service request folios use the CS prefix'
);

select ok(
  (
    select column_default::text not like '%SR-%'
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'service_requests'
      and column_name = 'folio'
  ),
  'The service request folio default no longer uses the SR prefix'
);

select is(
  valtrim.calculate_business_due_date(date '2026-09-21', 5),
  date '2026-09-28',
  'The reported weekday is excluded from the due-date window'
);

select is(
  valtrim.calculate_business_due_date(date '2026-09-25', 5),
  date '2026-10-02',
  'A Friday report is due on the following Friday'
);

select is(
  valtrim.calculate_business_due_date(date '2026-09-19', 5),
  date '2026-09-25',
  'A weekend report begins counting on the following Monday'
);

select col_type_is(
  'valtrim', 'jobs', 'community_latitude', 'numeric(18,15)',
  'Job latitude preserves source precision'
);

select col_type_is(
  'valtrim', 'jobs', 'community_longitude', 'numeric(18,15)',
  'Job longitude preserves source precision'
);

select col_not_null(
  'valtrim', 'jobs', 'community_latitude',
  'Job latitude remains required'
);

select col_not_null(
  'valtrim', 'jobs', 'community_longitude',
  'Job longitude remains required'
);

select col_type_is(
  'valtrim', 'service_properties', 'latitude', 'numeric(18,15)',
  'Request property latitude preserves source precision'
);

select col_type_is(
  'valtrim', 'service_properties', 'longitude', 'numeric(18,15)',
  'Request property longitude preserves source precision'
);

select col_is_null(
  'valtrim', 'service_properties', 'latitude',
  'Request property latitude remains optional'
);

select col_is_null(
  'valtrim', 'service_properties', 'longitude',
  'Request property longitude remains optional'
);

select has_function(
  'valtrim', 'read_customer_service_request_intakes', array['bigint'],
  'The canonical read contract remains available after widening coordinates'
);

select has_table(
  'valtrim', 'service_request_sources',
  'Sources remain available through the canonical intake contract'
);

select has_trigger(
  'valtrim', 'service_properties',
  'service_properties_supersede_proposals',
  'Coordinate changes continue superseding stale schedule proposals'
);

create temporary table point_two_fixture (
  property_id bigint not null,
  request_id bigint
) on commit drop;

do $$
declare
  v_property_id bigint;
begin
  insert into valtrim.service_properties (
    address,
    city,
    state,
    postal_code,
    latitude,
    longitude
  ) values (
    '123 Precision Test Ave',
    'Riverside',
    'CA',
    '92507',
    34.002337529815094,
    -117.346821482540830
  )
  returning id into v_property_id;

  insert into point_two_fixture (property_id)
  values (v_property_id);
end;
$$;

select results_eq(
  $$
    select property.latitude, property.longitude
    from valtrim.service_properties property
    join point_two_fixture fixture on fixture.property_id = property.id
  $$,
  $$
    values (
      34.002337529815094::numeric(18,15),
      -117.346821482540830::numeric(18,15)
    )
  $$,
  'Request property coordinates retain all supported decimal places'
);

do $$
declare
  v_request_id bigint;
begin
  insert into valtrim.service_requests (
    property_id,
    reported_on,
    homeowner_name,
    homeowner_phone,
    priority,
    description
  )
  select
    fixture.property_id,
    date '2026-09-21',
    'Point 2 Test Contact',
    '+19515550100',
    'MEDIUM',
    'Point 2 identifier and deadline verification'
  from point_two_fixture fixture
  returning id into v_request_id;

  update point_two_fixture
  set request_id = v_request_id;
end;
$$;

select ok(
  (
    select request.folio ~ '^CS-[0-9]{4,}$'
      and request.due_on = date '2026-09-28'
    from valtrim.service_requests request
    join point_two_fixture fixture on fixture.request_id = request.id
  ),
  'A new request receives a CS folio and the corrected due date'
);

select * from finish();

rollback;
