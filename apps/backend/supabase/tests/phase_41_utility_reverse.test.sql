begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select ok(coalesce((
  select procedure.prosrc like '%Utility Building rows cannot include Options%'
    and procedure.prosrc not like '%Utility Building rows cannot include Reverse or Options%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet validation allows Reverse on Utility rows');

select ok(coalesce((
  select procedure.prosrc like '%requested.value ->> ''is_reverse''%'
    and procedure.prosrc not like '%case when requested.is_utility_building then false%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet persistence preserves the requested Utility orientation');

select ok(coalesce((
  select procedure.prosrc like '%new.is_reverse := v_record.is_reverse%'
    and procedure.prosrc not like '%new.is_reverse := case when v_record.is_utility_building%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Package creation snapshots Reverse for Utility rows');

select ok(coalesce((
  select procedure.prosrc like '%new.options_amount := 0%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Utility Package rows still exclude Options');

select ok(coalesce((
  select procedure.prosrc like '%when v_record.is_utility_building then 0%'
  from pg_proc procedure
  where procedure.oid = 'valtrim.prepare_package_draw()'::regprocedure
), false), 'Utility Package rows still exclude Hardware');

select ok(coalesce((
  select obj_description(procedure.oid, 'pg_proc') like '%Both row types preserve Reverse%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Sequence Sheet function documents the shared Reverse behavior');

select * from finish();

rollback;
