-- Historical FULL setup versions remain untouched, but every setup version
-- saved after the event-allocation feature must use BY_EVENT when Separate
-- Hardware Price is enabled.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  v_definition text;
  v_expected text := $source$  if v_separate_hardware and v_hardware_mode = 'BY_EVENT' then$source$;
  v_replacement text := $source$  if v_separate_hardware and v_hardware_mode <> 'BY_EVENT' then
    raise exception 'New Separate Hardware setups must allocate 100 percent by Draw event'
      using errcode = '23514';
  end if;

  if v_separate_hardware and v_hardware_mode = 'BY_EVENT' then$source$;
begin
  select pg_get_functiondef(
    'valtrim.validate_setup_version(bigint)'::regprocedure
  ) into v_definition;

  if position(v_expected in v_definition) = 0 then
    raise exception 'Hardware allocation validation did not match the expected definition';
  end if;

  execute replace(v_definition, v_expected, v_replacement);
end;
$migration$;

notify pgrst, 'reload schema';

commit;
