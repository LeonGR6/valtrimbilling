-- Purchase Orders and the quantity of an Option on a Lot.
--
-- A Purchase Order line prints a quantity; the Sequence Sheet now has one too (lot_options.quantity). The
-- comparison tells when they differ, and importing an Option into a Lot takes the quantity of the line:
--
--   compare_purchase_orders      two more columns, the quantity and the locations of the Option on the Lot, and a
--                                new result QUANTITY_DIFF: the Option is on the Lot at the same price but with
--                                another quantity. A price that differs is still reported first.
--   import_purchase_order_options  an Option put on a Lot from a line takes the quantity of that line (a whole
--                                number from 1 to 99; any other quantity leaves it at 1).
--
-- Only the latest line of each Lot and Option code counts (purchase_order_current_lines), so a PDF that
-- prints the same Option twice for a Lot is read as its latest line.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- compare_purchase_orders: the return type changes, so it is dropped and created again from its live
-- definition, and the patch aborts when the text it expects is not there.

do $migration$
declare
  v_definition text := pg_catalog.pg_get_functiondef('valtrim.compare_purchase_orders(bigint)'::regprocedure);
  v_old text;
  v_new text;
  v_count integer;
begin
  for v_old, v_new in
    select * from (values
      (
        'conflicting_po_prices boolean, status text)',
        'conflicting_po_prices boolean, status text, system_quantity integer, system_locations text[])'
      ),
      (
        E'           is distinct from current_line.unit_price then ''PRICE_DIFF''\n      else ''MATCH''\n    end\n  from valtrim.purchase_order_current_lines current_line',
        E'           is distinct from current_line.unit_price then ''PRICE_DIFF''\n      when selected.quantity::numeric is distinct from current_line.quantity then ''QUANTITY_DIFF''\n      else ''MATCH''\n    end,\n    selected.quantity,\n    selected.locations\n  from valtrim.purchase_order_current_lines current_line'
      )
    ) as patches(old_text, new_text)
  loop
    v_count := (pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
      / pg_catalog.length(v_old);
    if v_count <> 1 then
      raise exception 'Cannot patch compare_purchase_orders: expected 1 occurrence of "%", found %',
        left(v_old, 60), v_count;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  end loop;

  drop function valtrim.compare_purchase_orders(bigint);
  execute v_definition;
end;
$migration$;

revoke all on function valtrim.compare_purchase_orders(bigint) from public, anon;
grant execute on function valtrim.compare_purchase_orders(bigint) to authenticated, service_role;

-- import_purchase_order_options: an Option added to a Lot takes the quantity of the line.

create function pg_temp.patch_function(
  p_signature regprocedure,
  p_old text,
  p_new text,
  p_expected_count integer default 1
)
returns void
language plpgsql
as $$
declare
  v_definition text := pg_catalog.pg_get_functiondef(p_signature);
  v_count integer;
begin
  v_count := (pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_old, '')))
    / pg_catalog.length(p_old);
  if v_count <> p_expected_count then
    raise exception 'Cannot patch %: expected % occurrence(s) of the old text, found %',
      p_signature, p_expected_count, v_count;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$$;

select pg_temp.patch_function(
  'valtrim.import_purchase_order_options(bigint[])'::regprocedure,
$old$      comparison.po_unit_price,
      lot.phase_id,$old$,
$new$      comparison.po_unit_price,
      comparison.quantity as po_quantity,
      lot.phase_id,$new$
);

select pg_temp.patch_function(
  'valtrim.import_purchase_order_options(bigint[])'::regprocedure,
$old$        insert into valtrim.lot_options (lot_id, plan_id, option_id)
        values (v_line.lot_id, v_line.plan_id, v_option_id);$old$,
$new$        insert into valtrim.lot_options (lot_id, plan_id, option_id, quantity)
        values (
          v_line.lot_id,
          v_line.plan_id,
          v_option_id,
          case
            when v_line.po_quantity between 1 and 99
              and v_line.po_quantity = trunc(v_line.po_quantity)
            then v_line.po_quantity::integer
            else 1
          end
        );$new$
);

notify pgrst, 'reload schema';

commit;
