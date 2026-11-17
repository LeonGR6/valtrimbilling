-- Record whether each immutable Builder Setup applies to a Utility Building.
-- This is metadata only for now and does not alter Draw or invoice behavior.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table valtrim.billing_setup_versions
  add column utility_building boolean not null default false;

comment on column valtrim.billing_setup_versions.utility_building is
  'Identifies a Utility Building Builder Setup. Informational only; no billing behavior is attached yet.';

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'valtrim.save_billing_setup_version(bigint,jsonb,jsonb,jsonb,bigint,uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    'setup_id, builder_id, version_number, separate_hardware_price,
      options_billing_draw_number',
    'setup_id, builder_id, version_number, separate_hardware_price,
      utility_building, options_billing_draw_number'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup insert columns did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'coalesce((p_config->>''separateHardwarePrice'')::boolean, false),
      nullif(p_config->>''optionsBillingDrawNumber'', '''')::smallint,',
    'coalesce((p_config->>''separateHardwarePrice'')::boolean, false),
      coalesce((p_config->>''utilityBuilding'')::boolean, false),
      nullif(p_config->>''optionsBillingDrawNumber'', '''')::smallint,'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup insert values did not match the expected definition';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    'separate_hardware_price = coalesce((p_config->>''separateHardwarePrice'')::boolean, false),
      options_billing_draw_number',
    'separate_hardware_price = coalesce((p_config->>''separateHardwarePrice'')::boolean, false),
      utility_building = coalesce((p_config->>''utilityBuilding'')::boolean, false),
      options_billing_draw_number'
  );
  if v_updated = v_definition then
    raise exception 'Builder Setup update values did not match the expected definition';
  end if;

  execute v_updated;
end;
$migration$;

comment on function valtrim.save_billing_setup_version(
  bigint, jsonb, jsonb, jsonb, bigint, uuid
) is
  'Creates or updates a Builder billing setup version, including its informational Utility Building flag and submission destination.';

notify pgrst, 'reload schema';

commit;
