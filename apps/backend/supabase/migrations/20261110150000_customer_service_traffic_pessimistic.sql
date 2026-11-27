-- Customer Service proposal fit, block R1 (docs/customer-service-proposal-fit-plan.md).
-- User-authorized (10 Nov 2026, decision D5): travel estimates use Google traffic at the
-- planned departure time with the PESSIMISTIC model, a time most days do not exceed.
-- Same SKU and cost per call as BEST_GUESS. Saved BEST_GUESS legs become out of date
-- under the traffic-mode rule and are calculated again when the planner uses them.
-- The settings screen is not mounted in the app, so the mode changes through migrations.
begin;

do $traffic$
declare
  v_count integer;
begin
  update valtrim.service_scheduling_settings
  set travel_traffic_mode = 'PESSIMISTIC'
  where id = 1 and travel_traffic_mode = 'BEST_GUESS';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Expected the traffic mode to be BEST_GUESS before switching to PESSIMISTIC; nothing was changed';
  end if;
end;
$traffic$;

commit;
