begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(coalesce((
  select procedure.prosrc like '%if v_utility_enabled and not v_has_utility then%'
    and procedure.prosrc like '%Every Phase requires at least one Utility Building row for this Job Billing Setup%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Utility-enabled Job Billing Setups require one Utility row per saved Phase');

select ok(coalesce((
  select procedure.prosrc like '%elsif v_has_utility and not v_utility_enabled then%'
    and procedure.prosrc like '%Utility Building is inactive for this Job Billing Setup%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Utility rows remain forbidden when the Job Billing Setup disables them');

select * from finish();

rollback;
