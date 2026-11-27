begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select is(
  valtrim.calculate_business_due_date(date '2026-09-21', 5),
  date '2026-09-28',
  'Monday is excluded and the following Monday is business day five'
);

create temporary table due_on_fixture (
  request_id bigint not null
) on commit drop;

do $$
declare
  v_property_id bigint;
  v_request_id bigint;
begin
  insert into valtrim.service_properties (address)
  values ('Due date test property')
  returning id into v_property_id;

  insert into valtrim.service_requests (
    property_id,
    reported_on,
    homeowner_name,
    priority,
    description
  ) values (
    v_property_id,
    date '2026-09-21',
    'Due Date Test Customer',
    'MEDIUM',
    'Validate the Customer Service deadline'
  )
  returning id into v_request_id;

  insert into due_on_fixture (request_id)
  values (v_request_id);
end;
$$;

select is(
  (
    select request.due_on
    from valtrim.service_requests request
    join due_on_fixture fixture on fixture.request_id = request.id
  ),
  date '2026-09-28',
  'Creating a request calculates due_on after reported_on'
);

update valtrim.service_requests request
set reported_on = date '2026-09-25'
from due_on_fixture fixture
where request.id = fixture.request_id;

select is(
  (
    select request.due_on
    from valtrim.service_requests request
    join due_on_fixture fixture on fixture.request_id = request.id
  ),
  date '2026-10-02',
  'Changing reported_on recalculates due_on from the following business day'
);

select * from finish();

rollback;
