-- The Phase reactivation branch was removed in the previous migration. Remove
-- its now-unused declaration so database lint remains clean.

begin;

do $migration$
declare
  v_definition text;
  v_declaration text := E'  v_phase_active boolean;\n';
begin
  select pg_get_functiondef(
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
  ) into v_definition;

  if position(v_declaration in v_definition) = 0 then
    raise exception 'save_sequence_sheet_phase does not contain the expected unused declaration';
  end if;

  execute replace(v_definition, v_declaration, '');
end;
$migration$;

notify pgrst, 'reload schema';

commit;
