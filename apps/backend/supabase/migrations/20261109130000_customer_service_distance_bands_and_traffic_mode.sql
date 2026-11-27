-- Customer Service routing, block 1 (docs/customer-service-routing-implementation-plan.md).
-- Approved 9 Nov 2026: distance bands 5 / 10 / 20 miles (green, yellow, orange; beyond 20 is red).
-- Adds the travel traffic mode (OFF by default, so nothing changes until it is enabled) and the
-- travel estimate columns for departure time, static minutes, traffic model and road distance.
-- Existing travel estimates keep their values; the new columns stay empty for them.
begin;

create type valtrim.service_travel_traffic_mode as enum ('OFF', 'BEST_GUESS', 'PESSIMISTIC');
create type valtrim.service_travel_traffic_model as enum ('BEST_GUESS', 'PESSIMISTIC');

alter table valtrim.service_scheduling_settings
  add column distance_orange_max_miles numeric(6,2) not null default 20
    constraint service_scheduling_settings_orange_positive
      check (distance_orange_max_miles > 0),
  add column travel_traffic_mode valtrim.service_travel_traffic_mode not null default 'OFF';

-- Set the bands before the ordering check exists: until this update the stored
-- yellow threshold (20) equals the new orange default (20).
update valtrim.service_scheduling_settings
set distance_green_max_miles = 5,
    distance_yellow_max_miles = 10,
    distance_orange_max_miles = 20
where id = 1;

alter table valtrim.service_scheduling_settings
  add constraint service_scheduling_settings_orange_after_yellow
    check (distance_orange_max_miles > distance_yellow_max_miles);

grant update (distance_orange_max_miles, travel_traffic_mode)
  on valtrim.service_scheduling_settings to authenticated;

comment on column valtrim.service_scheduling_settings.distance_orange_max_miles is
  'Upper orange threshold (10 to 20 miles by default). Greater distances are red; never a scheduling block.';
comment on column valtrim.service_scheduling_settings.travel_traffic_mode is
  'OFF uses Google traffic-unaware minutes. BEST_GUESS or PESSIMISTIC ask Google for traffic at the planned departure time.';

alter table valtrim.service_travel_estimates
  add column departure_at timestamptz,
  add column static_minutes smallint
    constraint service_travel_estimates_static_minutes_range
      check (static_minutes between 0 and 999),
  add column traffic_model valtrim.service_travel_traffic_model,
  add column distance_miles numeric(6,1)
    constraint service_travel_estimates_distance_nonnegative
      check (distance_miles >= 0),
  add constraint service_travel_estimates_traffic_needs_departure
    check (traffic_model is null or departure_at is not null);

comment on column valtrim.service_travel_estimates.departure_at is
  'Departure time the traffic estimate was calculated for. Null for estimates without traffic.';
comment on column valtrim.service_travel_estimates.static_minutes is
  'Driving minutes without traffic, kept next to a traffic estimate for reference.';
comment on column valtrim.service_travel_estimates.traffic_model is
  'Google traffic model used. Null when the estimate ignores traffic or was entered by hand.';
comment on column valtrim.service_travel_estimates.distance_miles is
  'Road driving distance in miles from Google, used for the nearby-visit color bands.';

notify pgrst, 'reload schema';

commit;
