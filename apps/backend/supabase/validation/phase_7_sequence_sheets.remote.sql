-- Rollback-only lifecycle and authorization validation for Phase 7.
-- Run against a linked test project after applying the migration.

begin;

do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'valtrim.phases'::regclass);
  assert (select relrowsecurity from pg_class where oid = 'valtrim.lots'::regclass);
  assert (select relrowsecurity from pg_class where oid = 'valtrim.lot_options'::regclass);
  assert has_table_privilege('authenticated', 'valtrim.phases', 'select');
  assert has_table_privilege('authenticated', 'valtrim.lots', 'select');
  assert has_table_privilege('authenticated', 'valtrim.lot_options', 'select');
  assert not has_table_privilege('authenticated', 'valtrim.phases', 'insert');
  assert not has_table_privilege('authenticated', 'valtrim.lots', 'update');
  assert not has_table_privilege('authenticated', 'valtrim.lot_options', 'delete');
  assert not has_sequence_privilege('authenticated', 'valtrim.phases_id_seq', 'usage');
  assert not has_sequence_privilege('authenticated', 'valtrim.lots_id_seq', 'usage');
  assert not has_table_privilege('anon', 'valtrim.phases', 'select');
  assert has_function_privilege(
    'authenticated',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)',
    'execute'
  );
  assert has_function_privilege(
    'authenticated',
    'valtrim.deactivate_sequence_sheet_phase(bigint)',
    'execute'
  );
  assert not has_function_privilege(
    'anon',
    'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)',
    'execute'
  );
  assert (
    select array_agg(policyname::text order by policyname)
    from pg_policies
    where schemaname = 'valtrim' and tablename = 'phases'
  ) = array['phases_select'];
  assert (
    select array_agg(policyname::text order by policyname)
    from pg_policies
    where schemaname = 'valtrim' and tablename = 'lots'
  ) = array['lots_select'];
  assert (
    select array_agg(policyname::text order by policyname)
    from pg_policies
    where schemaname = 'valtrim' and tablename = 'lot_options'
  ) = array['lot_options_select'];
  assert (
    select character_maximum_length
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'phases'
      and column_name = 'code'
  ) = 40;
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phases'::regclass
      and conname = 'phases_code_check'
      and contype = 'c'
  );
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.phases'::regclass
      and conname = 'phases_building_check'
      and contype = 'c'
  );
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lots'::regclass
      and conname = 'lots_lot_number_check'
      and contype = 'c'
  );
  assert exists (
    select 1 from pg_constraint
    where conrelid = 'valtrim.lots'::regclass
      and conname = 'lots_display_order_check'
      and contype = 'c'
  );
  assert to_regclass('valtrim.phases_created_by_idx') is not null;
  assert to_regclass('valtrim.phases_updated_by_idx') is not null;
  assert to_regclass('valtrim.lots_created_by_idx') is not null;
  assert to_regclass('valtrim.lots_updated_by_idx') is not null;
  assert to_regclass('valtrim.lot_options_selected_by_idx') is not null;
  assert exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.lot_options'::regclass
      and tgname = 'stamp_lot_option_selector'
      and not tgisinternal
  );
  assert (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.save_sequence_sheet_phase(bigint,bigint,text,text,jsonb)'::regprocedure
  );
  assert (
    select prosecdef
    from pg_proc
    where oid = 'valtrim.deactivate_sequence_sheet_phase(bigint)'::regprocedure
  );
  assert not has_table_privilege(
    'authenticated', 'valtrim.production_activities', 'select'
  );
  assert not has_table_privilege(
    'authenticated', 'valtrim.draw_packages', 'select'
  );
  assert not has_table_privilege(
    'authenticated', 'valtrim.invoices', 'select'
  );
  assert not has_table_privilege(
    'authenticated', 'valtrim.service_requests', 'select'
  );
end;
$$;

create temp table phase7_validation (
  admin_id uuid not null,
  readonly_id uuid not null,
  job_id bigint not null,
  option_plan_id bigint not null,
  other_plan_id bigint not null,
  option_id bigint,
  phase_id bigint,
  first_lot_id bigint,
  second_lot_id bigint
) on commit drop;

insert into phase7_validation (
  admin_id,
  readonly_id,
  job_id,
  option_plan_id,
  other_plan_id
)
select
  (
    select id
    from valtrim.app_users
    where role = 'ADMIN' and is_active
    order by created_at
    limit 1
  ),
  (
    select id
    from valtrim.app_users
    where role = 'READ_ONLY' and is_active
    order by created_at
    limit 1
  ),
  first_plan.job_id,
  first_plan.id,
  second_plan.id
from valtrim.plans first_plan
join lateral (
  select candidate.id
  from valtrim.plans candidate
  where candidate.job_id = first_plan.job_id
    and candidate.id <> first_plan.id
    and candidate.is_active
  order by candidate.id
  limit 1
) second_plan on true
join valtrim.jobs job on job.id = first_plan.job_id
where first_plan.is_active
  and job.is_active
order by first_plan.id
limit 1;

grant select, update on phase7_validation to authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase7_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase7_validation%rowtype;
  v_phase_id bigint;
  v_first_lot_id bigint;
  v_second_lot_id bigint;
  v_option_id bigint;
begin
  select * into strict v_test from phase7_validation;

  insert into valtrim.plan_options (plan_id, code, name, description)
  values (
    v_test.option_plan_id,
    'QA7-OPT',
    'QA7 selected option',
    'Rollback-only Phase 7 validation'
  )
  returning id into v_option_id;

  v_phase_id := valtrim.save_sequence_sheet_phase(
    v_test.job_id,
    null,
    ' qa7 ',
    ' b7 ',
    jsonb_build_array(
      jsonb_build_object(
        'id', null,
        'lot_number', '101',
        'plan_id', v_test.option_plan_id,
        'is_reverse', false,
        'option_ids', jsonb_build_array(v_option_id)
      ),
      jsonb_build_object(
        'id', null,
        'lot_number', '102',
        'plan_id', v_test.other_plan_id,
        'is_reverse', true,
        'option_ids', '[]'::jsonb
      )
    )
  );

  select id into strict v_first_lot_id
  from valtrim.lots
  where phase_id = v_phase_id and display_order = 0;

  select id into strict v_second_lot_id
  from valtrim.lots
  where phase_id = v_phase_id and display_order = 1;

  assert (
    select code = 'QA7' and building = 'B7' and is_active
    from valtrim.phases
    where id = v_phase_id
  );
  assert (
    select created_by = v_test.admin_id and updated_by = v_test.admin_id
    from valtrim.phases
    where id = v_phase_id
  ), 'Phase audit actor was not stamped';
  assert (select count(*) from valtrim.lots where phase_id = v_phase_id) = 2;
  assert (
    select bool_and(
      created_by = v_test.admin_id and updated_by = v_test.admin_id
    )
    from valtrim.lots
    where phase_id = v_phase_id
  ), 'Lot audit actors were not stamped';
  assert (
    select count(*)
    from valtrim.lot_options
    where lot_id = v_first_lot_id
      and option_id = v_option_id
  ) = 1;
  assert (
    select selected_by = v_test.admin_id
    from valtrim.lot_options
    where lot_id = v_first_lot_id
      and option_id = v_option_id
  ), 'Selected Option actor was not stamped';

  assert valtrim.save_sequence_sheet_phase(
    v_test.job_id,
    v_phase_id,
    'qa7',
    'b8',
    jsonb_build_array(
      jsonb_build_object(
        'id', v_first_lot_id,
        'lot_number', '102',
        'plan_id', v_test.other_plan_id,
        'is_reverse', false,
        'option_ids', '[]'::jsonb
      ),
      jsonb_build_object(
        'id', v_second_lot_id,
        'lot_number', '101',
        'plan_id', v_test.option_plan_id,
        'is_reverse', true,
        'option_ids', jsonb_build_array(v_option_id)
      )
    )
  ) = v_phase_id, 'Phase edit returned a different identity';

  assert (
    select lot_number = '102'
      and plan_id = v_test.other_plan_id
      and not is_reverse
    from valtrim.lots
    where id = v_first_lot_id
  );
  assert (
    select lot_number = '101'
      and plan_id = v_test.option_plan_id
      and is_reverse
    from valtrim.lots
    where id = v_second_lot_id
  );
  assert (
    select count(*)
    from valtrim.lot_options
    where lot_id = v_second_lot_id
      and option_id = v_option_id
  ) = 1;
  assert (
    select bool_and(updated_by = v_test.admin_id)
    from valtrim.lots
    where id in (v_first_lot_id, v_second_lot_id)
  ), 'Lot update actor was not stamped';

  begin
    insert into valtrim.phases (job_id, code, building)
    values (v_test.job_id, 'DENIED', 'DENIED');
    raise exception 'Direct Phase insert unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  update phase7_validation
  set option_id = v_option_id,
      phase_id = v_phase_id,
      first_lot_id = v_first_lot_id,
      second_lot_id = v_second_lot_id;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select readonly_id::text from phase7_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase7_validation%rowtype;
begin
  select * into strict v_test from phase7_validation;

  assert (
    select count(*)
    from valtrim.phases
    where id = v_test.phase_id and is_active
  ) = 1;
  assert (
    select count(*)
    from valtrim.lots
    where phase_id = v_test.phase_id
  ) = 2;
  assert (
    select count(*)
    from valtrim.lot_options
    where lot_id = v_test.second_lot_id
  ) = 1;

  begin
    perform valtrim.save_sequence_sheet_phase(
      v_test.job_id,
      v_test.phase_id,
      'QA7',
      'B8',
      jsonb_build_array(
        jsonb_build_object(
          'id', v_test.first_lot_id,
          'lot_number', '102',
          'plan_id', v_test.other_plan_id,
          'is_reverse', false,
          'option_ids', '[]'::jsonb
        )
      )
    );
    raise exception 'READ_ONLY Sequence Sheet save unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
begin
  begin
    perform valtrim.deactivate_sequence_sheet_phase(
      (select phase_id from phase7_validation)
    );
    raise exception 'Anonymous Phase deactivation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase7_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase7_validation%rowtype;
  v_reactivated_id bigint;
begin
  select * into strict v_test from phase7_validation;

  assert valtrim.deactivate_sequence_sheet_phase(v_test.phase_id) = v_test.phase_id;
  assert (
    select not is_active
    from valtrim.phases
    where id = v_test.phase_id
  );
  assert (select count(*) from valtrim.lots where phase_id = v_test.phase_id) = 0;
  assert (
    select count(*)
    from valtrim.lot_options
    where lot_id in (v_test.first_lot_id, v_test.second_lot_id)
  ) = 0;

  v_reactivated_id := valtrim.save_sequence_sheet_phase(
    v_test.job_id,
    null,
    'QA7',
    'B9',
    jsonb_build_array(
      jsonb_build_object(
        'id', null,
        'lot_number', '201',
        'plan_id', v_test.option_plan_id,
        'is_reverse', true,
        'option_ids', jsonb_build_array(v_test.option_id)
      )
    )
  );

  assert v_reactivated_id = v_test.phase_id;
  assert (
    select is_active and building = 'B9'
    from valtrim.phases
    where id = v_test.phase_id
  );
  assert (select count(*) from valtrim.lots where phase_id = v_test.phase_id) = 1;

  perform valtrim.deactivate_sequence_sheet_phase(v_test.phase_id);
end;
$$;

reset role;
rollback;
