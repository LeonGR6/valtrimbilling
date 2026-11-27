-- Treat the Builder Setup Options billing Draw as the first eligible Draw.
-- Pending Options may be charged by a later selected Draw, while legacy and
-- correction flows without an explicit Option payload retain exact-Draw behavior.
begin;

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.prepare_package_draw()'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'if v_record.draw_number = v_record.options_billing_draw_number then',
    $replacement$if v_record.draw_number = v_record.options_billing_draw_number
     or nullif(
       current_setting('valtrim.draw_package_option_charge', true), ''
     ) is not null then$replacement$
  );

  if v_updated = v_definition then
    raise exception 'prepare_package_draw Options gate did not match the expected definition';
  end if;

  execute v_updated;

  select pg_get_functiondef(
    'valtrim.populate_package_options()'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $original$if new.draw_number = (
    select options_billing_draw_number
    from valtrim.billing_setup_versions where id = new.setup_version_id
  ) then$original$,
    $replacement$if new.draw_number = (
    select options_billing_draw_number
    from valtrim.billing_setup_versions where id = new.setup_version_id
  ) or nullif(
    current_setting('valtrim.draw_package_option_charge', true), ''
  ) is not null then$replacement$
  );

  if v_updated = v_definition then
    raise exception 'populate_package_options Options gate did not match the expected definition';
  end if;

  execute v_updated;

  select pg_get_functiondef(
    'private.create_draw_invoice_package(bigint,jsonb,date,date,date,text)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $original$and (item->>'draw_number')::smallint
        is distinct from v_options_billing_draw_number$original$,
    $replacement$and (item->>'draw_number')::smallint
        < v_options_billing_draw_number$replacement$
  );

  if v_updated = v_definition then
    raise exception 'create_draw_invoice_package anchor validation did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'Options may only be selected on the configured Options billing Draw',
    'Options may only be selected on or after the configured Options billing Draw'
  );

  if v_updated = v_definition then
    raise exception 'create_draw_invoice_package anchor message did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'and current_selection.draw_number = v_options_billing_draw_number',
    'and current_selection.draw_number >= v_options_billing_draw_number'
  );

  if v_updated = v_definition then
    raise exception 'create_draw_invoice_package current eligibility did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    $original$and prior_line.draw_number
                  = prior_version.options_billing_draw_number$original$,
    $replacement$and prior_line.draw_number
                  >= prior_version.options_billing_draw_number$replacement$
  );

  if v_updated = v_definition then
    raise exception 'create_draw_invoice_package prior eligibility did not match the expected definition';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'Every selected Option Lot must have reached the Options billing Draw',
    'Every selected Option Lot must have reached or passed the Options billing Draw'
  );

  if v_updated = v_definition then
    raise exception 'create_draw_invoice_package eligibility message did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

comment on function valtrim.create_draw_invoice_package(
  bigint, jsonb, date, date, date, text
) is
  'Creates one Package from exact Lot / Draw cells. One cell at or after the configured Options billing Draw may carry pending package_options from any Lot in the Job that reached that Draw or a later Draw; each Lot Option can be billed only once.';

notify pgrst, 'reload schema';

commit;
