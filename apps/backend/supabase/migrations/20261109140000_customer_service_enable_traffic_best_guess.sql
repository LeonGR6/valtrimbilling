-- Customer Service routing, block 4 (docs/customer-service-routing-implementation-plan.md).
-- User-authorized (9 Nov 2026, traffic approved by the user's boss): travel estimates use
-- Google traffic at the planned departure time with the BEST_GUESS model. The settings
-- screen is not mounted in the app, so the mode changes through migrations. To turn it
-- off, write a new migration that sets 'OFF'.
begin;

do $traffic$
declare
  v_count integer;
begin
  update valtrim.service_scheduling_settings
  set travel_traffic_mode = 'BEST_GUESS'
  where id = 1 and travel_traffic_mode = 'OFF';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Expected the traffic mode to be OFF before enabling it; nothing was changed';
  end if;
end;
$traffic$;

commit;
