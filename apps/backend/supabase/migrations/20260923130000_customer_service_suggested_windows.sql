begin;

-- New requests count their five business days from the creation date in the
-- company time zone. Existing due dates are deliberately left unchanged.
create or replace function private.set_service_request_due_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business_days integer;
  v_time_zone text;
  v_workday_ends_at time;
  v_created_local timestamp;
  v_start_on date;
begin
  select settings.business_days_to_complete,
         settings.time_zone,
         settings.workday_ends_at
  into v_business_days, v_time_zone, v_workday_ends_at
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;

  v_created_local := coalesce(new.created_at, now()) at time zone
    coalesce(v_time_zone, 'America/Los_Angeles');
  v_start_on := v_created_local::date;
  if v_created_local::time >= coalesce(v_workday_ends_at, time '17:00') then
    v_start_on := v_start_on + 1;
  end if;

  new.due_on := valtrim.calculate_business_due_date(
    v_start_on,
    coalesce(v_business_days, 5)
  );

  return new;
end;
$$;

drop trigger service_requests_set_due_on on valtrim.service_requests;
create trigger service_requests_set_due_on
before insert on valtrim.service_requests
for each row execute function private.set_service_request_due_on();

-- Proposed dates are not customer availability. An empty array keeps the
-- request in intake and is_ready_to_schedule remains false until the customer
-- actually supplies a window. Keep the original signature for existing RPCs.
create or replace function private.replace_customer_service_availability_internal(
  p_request_id bigint,
  p_availability jsonb,
  p_reported_on date,
  p_due_on date,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_time_zone text;
  v_workday_ends_at time;
  v_created_local timestamp;
  v_start_on date;
  v_window jsonb;
  v_available_from timestamptz;
  v_available_until timestamptz;
begin
  if p_availability is not null
     and jsonb_typeof(p_availability) <> 'array' then
    raise exception 'Customer availability must be an array'
      using errcode = '22023';
  end if;

  select settings.time_zone, settings.workday_ends_at
  into v_time_zone, v_workday_ends_at
  from valtrim.service_scheduling_settings settings
  where settings.id = 1;
  v_time_zone := coalesce(v_time_zone, 'America/Los_Angeles');

  select request.created_at at time zone v_time_zone
  into v_created_local
  from valtrim.service_requests request
  where request.id = p_request_id;
  v_start_on := coalesce(v_created_local::date, p_reported_on);
  if v_created_local::time >= coalesce(v_workday_ends_at, time '17:00') then
    v_start_on := v_start_on + 1;
  end if;
  v_start_on := valtrim.calculate_business_due_date(v_start_on, 1);

  delete from valtrim.service_request_availability availability
  where availability.request_id = p_request_id;

  if p_availability is null then
    return;
  end if;

  for v_window in
    select availability_window.value
    from jsonb_array_elements(p_availability) availability_window(value)
  loop
    if jsonb_typeof(v_window) <> 'object'
       or nullif(btrim(v_window ->> 'availableFrom'), '') is null
       or nullif(btrim(v_window ->> 'availableUntil'), '') is null then
      raise exception 'Every availability window needs availableFrom and availableUntil'
        using errcode = '22023';
    end if;

    begin
      v_available_from := (v_window ->> 'availableFrom')::timestamptz;
      v_available_until := (v_window ->> 'availableUntil')::timestamptz;
    exception
      when invalid_datetime_format or invalid_text_representation then
        raise exception 'Customer availability contains an invalid date or time'
          using errcode = '22023';
    end;

    if v_available_until <= v_available_from then
      raise exception 'Availability must end after it starts'
        using errcode = '22023';
    end if;

    if timezone(v_time_zone, v_available_from)::date < v_start_on
       or timezone(v_time_zone, v_available_from)::date > p_due_on
       or timezone(v_time_zone, v_available_until)::date < v_start_on
       or timezone(v_time_zone, v_available_until)::date > p_due_on then
      raise exception 'Availability must be inside the five-business-day service window'
        using errcode = '22023';
    end if;

    insert into valtrim.service_request_availability (
      request_id, available_from, available_until, notes,
      created_by, updated_by
    ) values (
      p_request_id,
      v_available_from,
      v_available_until,
      nullif(btrim(v_window ->> 'notes'), ''),
      p_actor_id,
      p_actor_id
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;
