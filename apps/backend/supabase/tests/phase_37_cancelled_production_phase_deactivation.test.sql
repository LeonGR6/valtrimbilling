begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select ok(
  not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.phases'::regclass
      and constraint_record.conname = 'phases_job_id_code_key'
  ),
  'Archived Phase codes no longer prevent a new active Phase identity'
);

select ok(coalesce((
  select pg_get_expr(index_record.indpred, index_record.indrelid)
    like '%is_active%'
  from pg_index index_record
  join pg_class index_class on index_class.oid = index_record.indexrelid
  where index_record.indrelid = 'valtrim.phases'::regclass
    and index_class.relname = 'phases_job_active_code_uq'
    and index_record.indisunique
), false), 'Phase codes remain unique among active rows of the same Job');

select ok(coalesce((
  select procedure.prosrc like '%and phase.is_active%'
    and procedure.prosrc not like '%elsif v_phase_active then%'
    and procedure.prosrc not like '%v_phase_active%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb,boolean)'::regprocedure
), false), 'Creating a Phase never reactivates an archived Production snapshot');

select ok(coalesce((
  select procedure.prosrc like '%v_has_cancelled_production_history%'
    and procedure.prosrc like '%activity.status <> ''CANCELLED''%'
    and procedure.prosrc like '%used by a Draw Package%'
    and procedure.prosrc like '%if not v_has_cancelled_production_history then%'
  from pg_proc procedure
  where procedure.oid =
    'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure
), false), 'Phase deletion archives cancelled Production while retaining real billing and Production blockers');

select * from finish();

rollback;
