-- The Options of a Package are added to the invoice on the line that carries them.
--
-- A Builder setup says in which Draw the Options are billed ("Options billing Draw"), and a Package
-- may carry them on any Draw at or after it: when the Package does not include that Draw (it was
-- billed in an earlier Package, or the Lots only reached a later one) the Options go with the first
-- Draw the Package does bill. create_draw_invoice_package already accepts that, and
-- populate_package_options already saves the Options on that line. prepare_package_draw, which
-- calculates the amounts of the line, still only added them to the line of the exact Options billing
-- Draw. So a Package that billed only a later Draw (DP-00000106: Draw 3, with the Options billed in
-- Draw 2) kept its Options saved and shown, and left them out of the line, out of the invoice total
-- and out of the QuickBooks invoice.
--
-- 1. prepare_package_draw adds the Options to the line a Package carries them on, as
--    populate_package_options already decides: on the exact Options Draw, or on the line the
--    request names. Anything that does not name a line (the correction flows) keeps the exact Draw.
-- 2. create_draw_invoice_package checks, once the lines are in, that the Options saved on the Package
--    add up to what its lines bill, so the two can never part again without the Package failing to
--    be created.
--
-- A Package that was already created with its Options left out is not changed here: a Draft Package
-- is recalculated (the Package page, Edit, or the price update) and the amounts are calculated
-- again with this function.

begin;

do $migration$
declare
  v_definition text;
  v_updated text;
  v_target constant text :=
    'and v_record.draw_number = v_record.options_billing_draw_number then';
begin
  select pg_get_functiondef('valtrim.prepare_package_draw()'::regprocedure)
  into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_target, '')))
     / length(v_target) <> 1 then
    raise exception 'prepare_package_draw does not have the expected Options billing Draw condition';
  end if;

  v_updated := replace(
    v_definition,
    v_target,
    E'and (\n       v_record.draw_number = v_record.options_billing_draw_number\n'
    || E'       or nullif(current_setting(''valtrim.draw_package_option_charge'', true), '''') is not null\n'
    || E'     ) then'
  );

  execute v_updated;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_updated text;
  v_target constant text := E'  if v_inserted <> v_requested then\n';
begin
  select pg_get_functiondef(
    'private.create_draw_invoice_package(bigint,jsonb,date,text)'::regprocedure
  ) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_target, '')))
     / length(v_target) <> 1 then
    raise exception 'create_draw_invoice_package does not have the expected line count check';
  end if;

  v_updated := replace(
    v_definition,
    v_target,
    E'  -- The Options saved on the Package are what its lines bill.\n'
    || E'  if (\n'
    || E'    select coalesce(sum(billed.option_price), 0)\n'
    || E'    from valtrim.package_options billed\n'
    || E'    where billed.package_id = v_package_id\n'
    || E'  ) <> (\n'
    || E'    select coalesce(sum(line.options_amount), 0)\n'
    || E'    from valtrim.package_draws line\n'
    || E'    where line.package_id = v_package_id\n'
    || E'  ) then\n'
    || E'    raise exception ''The Options of this Package do not add up to what its lines bill''\n'
    || E'      using errcode = ''23514'';\n'
    || E'  end if;\n\n'
    || v_target
  );

  execute v_updated;
end;
$migration$;

commit;
