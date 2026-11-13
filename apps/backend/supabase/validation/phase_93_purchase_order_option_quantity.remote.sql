-- Validation of 20261207120000_purchase_order_option_quantity.sql.
-- Run it on the remote database after the migration; it changes data inside a transaction and always
-- finishes with an exception whose message carries the results, so nothing is kept.
do $validation$
declare
  v_job bigint;
  v_line bigint;
  v_lot bigint;
  v_option bigint;
  v_status text;
  v_quantity integer;
  v_after integer;
  v_report text := '';
  v_failures integer := 0;

begin
  -- A Job with a line that matches the Sheet exactly.
  for v_job in select distinct job_id from valtrim.purchase_order_lines order by 1 loop
    select line_id, lot_id, plan_option_id
      into v_line, v_lot, v_option
      from valtrim.compare_purchase_orders(v_job)
      where status = 'MATCH'
      limit 1;
    exit when v_line is not null;
  end loop;

  if v_line is null then
    raise exception 'RESULTS: no Purchase Order line matches a Sheet, nothing to validate';
  end if;
  v_report := v_report || format('job %s line %s lot %s option %s; ', v_job, v_line, v_lot, v_option);

  -- 1. A line that matches shows the Sheet quantity (1) in the new column.
  select system_quantity into v_quantity
    from valtrim.compare_purchase_orders(v_job) where line_id = v_line;
  v_report := v_report || format('1 MATCH system_quantity=%s %s; ', v_quantity,
    case when v_quantity = 1 then 'ok' else 'FAIL' end);
  if v_quantity is distinct from 1 then v_failures := v_failures + 1; end if;

  alter table valtrim.lot_options disable trigger lot_options_quantity_guard;

  -- 2. The Sheet says 3 and the PDF says 1: QUANTITY_DIFF.
  update valtrim.lot_options set quantity = 3, locations = array['1st floor', '2nd floor']
    where lot_id = v_lot and option_id = v_option;
  select status, system_quantity into v_status, v_quantity
    from valtrim.compare_purchase_orders(v_job) where line_id = v_line;
  v_report := v_report || format('2 sheet 3 vs PO 1 -> %s qty=%s %s; ', v_status, v_quantity,
    case when v_status = 'QUANTITY_DIFF' and v_quantity = 3 then 'ok' else 'FAIL' end);
  if v_status is distinct from 'QUANTITY_DIFF' or v_quantity is distinct from 3 then
    v_failures := v_failures + 1;
  end if;

  -- 3. The locations travel with the line.
  select count(*) into v_after
    from valtrim.compare_purchase_orders(v_job)
    where line_id = v_line and system_locations = array['1st floor', '2nd floor'];
  v_report := v_report || format('3 locations returned=%s %s; ', v_after,
    case when v_after = 1 then 'ok' else 'FAIL' end);
  if v_after <> 1 then v_failures := v_failures + 1; end if;

  -- 4. The PDF also says 3: MATCH again.
  update valtrim.purchase_order_lines set quantity = 3, total = unit_price * 3 where id = v_line;
  select status into v_status from valtrim.compare_purchase_orders(v_job) where line_id = v_line;
  v_report := v_report || format('4 sheet 3 vs PO 3 -> %s %s; ', v_status,
    case when v_status = 'MATCH' then 'ok' else 'FAIL' end);
  if v_status is distinct from 'MATCH' then v_failures := v_failures + 1; end if;

  -- 5. A different price is still reported before the quantity.
  update valtrim.purchase_order_lines set quantity = 1, total = unit_price,
    unit_price = unit_price + 7 where id = v_line;
  select status into v_status from valtrim.compare_purchase_orders(v_job) where line_id = v_line;
  v_report := v_report || format('5 price and quantity differ -> %s %s; ', v_status,
    case when v_status = 'PRICE_DIFF' then 'ok' else 'FAIL' end);
  if v_status is distinct from 'PRICE_DIFF' then v_failures := v_failures + 1; end if;
  update valtrim.purchase_order_lines set unit_price = unit_price - 7 where id = v_line;

  -- 6. Importing an Option from a line puts it on the Lot with the quantity of the line. The Option has to be
  -- off the Lot first, and the Package rows that hold it go too (the guards are switched off; all is rolled back).
  alter table valtrim.lot_options disable trigger lot_options_quantity_guard;
  -- importing also skips a Phase that already has billed Draws or Hardware, so those rows go too.
  alter table valtrim.package_options disable trigger user;
  alter table valtrim.package_draws disable trigger user;
  alter table valtrim.package_hardware_lines disable trigger user;
  delete from valtrim.package_options
    where lot_id in (select id from valtrim.lots where phase_id = (select phase_id from valtrim.lots where id = v_lot));
  delete from valtrim.package_draws
    where lot_id in (select id from valtrim.lots where phase_id = (select phase_id from valtrim.lots where id = v_lot));
  delete from valtrim.package_hardware_lines
    where lot_id in (select id from valtrim.lots where phase_id = (select phase_id from valtrim.lots where id = v_lot));
  update valtrim.purchase_order_lines set quantity = 4, total = unit_price * 4 where id = v_line;
  delete from valtrim.lot_options where lot_id = v_lot and option_id = v_option;
  select status into v_status from valtrim.compare_purchase_orders(v_job) where line_id = v_line;
  v_report := v_report || format('6a Option out of the Lot -> %s; ', v_status);
  perform valtrim.import_purchase_order_options(array[v_line]);
  select quantity into v_after from valtrim.lot_options where lot_id = v_lot and option_id = v_option;
  v_report := v_report || format('6b imported quantity=%s %s; ', v_after,
    case when v_after = 4 then 'ok' else 'FAIL' end);
  if v_after is distinct from 4 then v_failures := v_failures + 1; end if;

  -- 7. A quantity that is not a whole number leaves the Option at 1.
  delete from valtrim.lot_options where lot_id = v_lot and option_id = v_option;
  update valtrim.purchase_order_lines set quantity = 2.5, total = unit_price * 2.5 where id = v_line;
  perform valtrim.import_purchase_order_options(array[v_line]);
  select quantity into v_after from valtrim.lot_options where lot_id = v_lot and option_id = v_option;
  v_report := v_report || format('7 quantity 2.5 imported as %s %s; ', v_after,
    case when v_after = 1 then 'ok' else 'FAIL' end);
  if v_after is distinct from 1 then v_failures := v_failures + 1; end if;

  raise exception 'RESULTS (% failures): %', v_failures, v_report;
end;
$validation$;
