-- Cover every composite foreign key introduced for immutable Separate Hardware
-- snapshots so validation and parent-row maintenance stay index-backed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create index package_hardware_lines_package_builder_idx
  on valtrim.package_hardware_lines (package_id, builder_id);
create index package_hardware_lines_lot_phase_idx
  on valtrim.package_hardware_lines (lot_id, phase_id);
create index package_hardware_lines_lot_plan_idx
  on valtrim.package_hardware_lines (lot_id, plan_id);
create index package_hardware_lines_plan_price_idx
  on valtrim.package_hardware_lines (plan_price_id, plan_id);

commit;
