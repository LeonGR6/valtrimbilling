-- A Job inherits Utility Building behavior from its immutable Billing Setup
-- version. When that capability is active, every newly saved Phase must keep
-- at least one named Utility row.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $migration$
declare
  v_definition text;
  v_expected text := 'if v_has_utility and not v_utility_enabled then
    raise exception ''Utility Building is inactive for this Job Billing Setup''
      using errcode = ''23514'';
  end if;';
begin
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  if position(v_expected in v_definition) = 0 then
    raise exception 'save_sequence_sheet_phase does not match the expected Utility requirement definition';
  end if;

  v_definition := replace(
    v_definition,
    v_expected,
    'if v_utility_enabled and not v_has_utility then
    raise exception ''Every Phase requires at least one Utility Building row for this Job Billing Setup''
      using errcode = ''23514'';
  elsif v_has_utility and not v_utility_enabled then
    raise exception ''Utility Building is inactive for this Job Billing Setup''
      using errcode = ''23514'';
  end if;'
  );

  execute v_definition;
end;
$migration$;

comment on function valtrim.save_sequence_sheet_phase(
  bigint, bigint, text, text, jsonb, boolean
) is
  'Atomically saves mixed ordinary Lots and named Plan-only Utility Building rows in one Phase. Jobs whose immutable Billing Setup enables Utility Building require at least one Utility row per Phase.';

notify pgrst, 'reload schema';

commit;
