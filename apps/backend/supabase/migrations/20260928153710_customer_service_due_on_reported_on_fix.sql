begin;

-- The reported business day counts as day one of the five-day deadline.
create or replace function private.set_service_request_due_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_days integer;
begin
  select settings.business_days_to_complete
  into v_business_days
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  new.due_on := valtrim.calculate_business_due_date(
    new.reported_on,
    coalesce(v_business_days, 5)
  );

  return new;
end;
$$;

revoke all on function private.set_service_request_due_on()
  from public, anon, authenticated;

drop trigger if exists service_requests_set_due_on
  on valtrim.service_requests;

create trigger service_requests_set_due_on
before insert or update of reported_on
on valtrim.service_requests
for each row execute function private.set_service_request_due_on();

-- Keep completed history stable while correcting every active deadline.
update valtrim.service_requests request
set due_on = valtrim.calculate_business_due_date(
  request.reported_on,
  settings.business_days_to_complete
)
from valtrim.service_scheduling_settings settings
where settings.id = 1
  and request.status not in ('COMPLETED', 'CLOSED')
  and request.due_on is distinct from valtrim.calculate_business_due_date(
    request.reported_on,
    settings.business_days_to_complete
  );

notify pgrst, 'reload schema';

commit;
