begin;

create temporary table phase10_validation (
  admin_id uuid not null,
  scheduling_id uuid not null,
  phase_id bigint not null,
  builder_id bigint not null,
  lot_ids bigint[] not null,
  test_builder_id bigint,
  activity_id bigint
) on commit drop;

insert into phase10_validation (
  admin_id,
  scheduling_id,
  phase_id,
  builder_id,
  lot_ids
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
  candidate.phase_id,
  candidate.builder_id,
  candidate.lot_ids
from (
  select
    phase.id as phase_id,
    job.builder_id,
    (array_agg(lot.id order by lot.display_order, lot.id))[1:5] as lot_ids
  from valtrim.phases phase
  join valtrim.jobs job
    on job.id = phase.job_id
   and job.is_active
  join valtrim.lots lot
    on lot.phase_id = phase.id
  join valtrim.people supervisor
    on supervisor.id = job.supervisor_id
   and supervisor.is_active
  join valtrim.builder_contacts superintendent
    on superintendent.id = job.superintendent_id
   and superintendent.is_active
  where phase.is_active
  group by phase.id, job.builder_id
  having count(*) >= 5
  order by phase.id
  limit 1
) candidate;

grant select, update on phase10_validation to authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase10_validation),
  true
);
set local role authenticated;

do $$
declare
  v_builder_id bigint;
begin
  insert into valtrim.builders (code, name)
  values ('CALV10VERIFY', 'Calendar Phase 10 Verification')
  returning id into v_builder_id;

  if (
    select row(ext_to_dm_weeks, shutter_before_dm_weeks, dm_to_hw_weeks)
    from valtrim.builders
    where id = v_builder_id
  ) is distinct from row(4::smallint, 1::smallint, 1::smallint) then
    raise exception 'A new Builder did not receive the 4/1/1 default date configuration';
  end if;

  update phase10_validation
  set test_builder_id = v_builder_id;
end;
$$;

reset role;

-- Reuse the active READ_ONLY validation identity as SCHEDULING only inside
-- this rollback-only transaction so the dedicated role can be exercised.
update valtrim.app_users
set role = 'SCHEDULING'
where id = (select scheduling_id from phase10_validation);

select set_config(
  'request.jwt.claim.sub',
  (select scheduling_id::text from phase10_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase10_validation%rowtype;
  v_activity_id bigint;
  v_ext_base_id bigint;
  v_ext_install_id bigint;
  v_shutter_id bigint;
  v_dm_first_id bigint;
  v_dm_second_id bigint;
  v_dm_install_id bigint;
  v_hw_base_id bigint;
  v_hw_lock_up_id bigint;
begin
  select * into strict v_test from phase10_validation;

  perform valtrim.save_builder_date_configuration(
    v_test.test_builder_id,
    6::smallint,
    2::smallint,
    2::smallint
  );

  if (
    select row(ext_to_dm_weeks, shutter_before_dm_weeks, dm_to_hw_weeks)
    from valtrim.builders
    where id = v_test.test_builder_id
  ) is distinct from row(6::smallint, 2::smallint, 2::smallint) then
    raise exception 'SCHEDULING could not persist Builder date configuration';
  end if;

  select valtrim.save_production_activity(
    null,
    v_test.phase_id,
    v_test.lot_ids,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'EXT',
        'orderMaterial', true,
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'variant', 'BASE',
            'date', '2026-09-10',
            'dateOwner', 'SUPERVISOR',
            'note', 'Original EXT date.',
            'lotIds', to_jsonb(v_test.lot_ids)
          ),
          jsonb_build_object(
            'variant', 'INSTALL_ONLY',
            'date', '2026-09-12',
            'dateOwner', 'TENTATIVE',
            'note', 'EXT install only.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'SHUTTER',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'variant', 'BASE',
            'date', '2026-10-01',
            'dateOwner', 'TENTATIVE',
            'note', 'Shutter visit.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'DM',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'variant', 'DIVISION',
            'date', '2026-10-08',
            'dateOwner', 'TENTATIVE',
            'note', 'DM division one.',
            'lotIds', to_jsonb(v_test.lot_ids[1:2])
          ),
          jsonb_build_object(
            'variant', 'DIVISION',
            'date', '2026-10-09',
            'dateOwner', 'JOBSITE_SUPERINTENDENT',
            'note', 'DM division two.',
            'lotIds', to_jsonb(v_test.lot_ids[3:5])
          ),
          jsonb_build_object(
            'variant', 'INSTALL_ONLY',
            'date', '2026-10-10',
            'dateOwner', 'TENTATIVE',
            'note', 'DM install only.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'HW',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'variant', 'BASE',
            'date', '2026-10-15',
            'dateOwner', 'TENTATIVE',
            'note', 'Hardware.',
            'lotIds', to_jsonb(v_test.lot_ids)
          ),
          jsonb_build_object(
            'variant', 'LOCK_UP',
            'date', '2026-10-16',
            'dateOwner', 'SUPERVISOR',
            'note', 'Secure building.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      )
    ),
    'Remote rollback lifecycle.'
  ) into v_activity_id;

  if (select count(*) from valtrim.production_activities where id = v_activity_id) <> 1
     or (select count(*) from valtrim.production_activity_lots where activity_id = v_activity_id) <> 5
     or (select count(*) from valtrim.production_stages where activity_id = v_activity_id and is_enabled) <> 4
     or (select count(*) from valtrim.production_schedules where activity_id = v_activity_id and is_active) <> 8
     or (
       select count(*)
       from valtrim.production_schedule_lots schedule_lot
       join valtrim.production_schedules schedule on schedule.id = schedule_lot.schedule_id
       where schedule.activity_id = v_activity_id and schedule.is_active
     ) <> 35 then
    raise exception 'The complete Production group was not persisted atomically';
  end if;

  select schedule.id into strict v_ext_base_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'EXT'
    and schedule.variant = 'BASE'
    and schedule.is_active;

  select schedule.id into strict v_ext_install_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'EXT'
    and schedule.variant = 'INSTALL_ONLY'
    and schedule.is_active;

  select schedule.id into strict v_shutter_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'SHUTTER'
    and schedule.variant = 'BASE'
    and schedule.is_active;

  select schedule.id into strict v_dm_first_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  join valtrim.production_schedule_lots schedule_lot on schedule_lot.schedule_id = schedule.id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'DM'
    and schedule.variant = 'DIVISION'
    and schedule.is_active
  group by schedule.id
  order by min(schedule_lot.lot_id)
  limit 1;

  select schedule.id into strict v_dm_second_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  join valtrim.production_schedule_lots schedule_lot on schedule_lot.schedule_id = schedule.id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'DM'
    and schedule.variant = 'DIVISION'
    and schedule.is_active
  group by schedule.id
  order by min(schedule_lot.lot_id) desc
  limit 1;

  select schedule.id into strict v_dm_install_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'DM'
    and schedule.variant = 'INSTALL_ONLY'
    and schedule.is_active;

  select schedule.id into strict v_hw_base_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'HW'
    and schedule.variant = 'BASE'
    and schedule.is_active;

  select schedule.id into strict v_hw_lock_up_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'HW'
    and schedule.variant = 'LOCK_UP'
    and schedule.is_active;

  perform valtrim.save_production_activity(
    v_activity_id,
    v_test.phase_id,
    v_test.lot_ids,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'EXT',
        'orderMaterial', false,
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'id', v_ext_base_id,
            'variant', 'BASE',
            'date', '2026-09-11',
            'dateOwner', 'JOBSITE_SUPERINTENDENT',
            'note', 'Replacement EXT date.',
            'lotIds', to_jsonb(v_test.lot_ids)
          ),
          jsonb_build_object(
            'id', v_ext_install_id,
            'variant', 'INSTALL_ONLY',
            'date', '2026-09-12',
            'dateOwner', 'TENTATIVE',
            'note', 'EXT install only.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'SHUTTER',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'id', v_shutter_id,
            'variant', 'BASE',
            'date', '2026-10-01',
            'dateOwner', 'TENTATIVE',
            'note', 'Shutter visit.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'DM',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'id', v_dm_first_id,
            'variant', 'DIVISION',
            'date', '2026-10-08',
            'dateOwner', 'TENTATIVE',
            'note', 'DM division one.',
            'lotIds', to_jsonb(v_test.lot_ids[1:2])
          ),
          jsonb_build_object(
            'id', v_dm_second_id,
            'variant', 'DIVISION',
            'date', '2026-10-09',
            'dateOwner', 'JOBSITE_SUPERINTENDENT',
            'note', 'DM division two.',
            'lotIds', to_jsonb(v_test.lot_ids[3:5])
          ),
          jsonb_build_object(
            'id', v_dm_install_id,
            'variant', 'INSTALL_ONLY',
            'date', '2026-10-10',
            'dateOwner', 'TENTATIVE',
            'note', 'DM install only.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      ),
      jsonb_build_object(
        'type', 'HW',
        'schedules', jsonb_build_array(
          jsonb_build_object(
            'id', v_hw_base_id,
            'variant', 'BASE',
            'date', '2026-10-15',
            'dateOwner', 'TENTATIVE',
            'note', 'Hardware.',
            'lotIds', to_jsonb(v_test.lot_ids)
          ),
          jsonb_build_object(
            'id', v_hw_lock_up_id,
            'variant', 'LOCK_UP',
            'date', '2026-10-16',
            'dateOwner', 'SUPERVISOR',
            'note', 'Secure building.',
            'lotIds', to_jsonb(v_test.lot_ids)
          )
        )
      )
    ),
    'Remote rollback lifecycle updated.'
  );

  if (select count(*) from valtrim.production_schedules where activity_id = v_activity_id and is_active) <> 8
     or (select scheduled_date from valtrim.production_schedules where id = v_ext_base_id) <> '2026-09-11'::date
     or (
       select count(*)
       from valtrim.production_date_history history
       where history.schedule_id = v_ext_base_id
         and history.previous_date = '2026-09-10'::date
         and history.new_date = '2026-09-11'::date
         and history.previous_owner = 'SUPERVISOR'
         and history.new_owner = 'JOBSITE_SUPERINTENDENT'
         and history.previous_note = 'Original EXT date.'
         and history.new_note = 'Replacement EXT date.'
     ) <> 1 then
    raise exception 'The persisted schedule identity or date history was not preserved on update';
  end if;

  update phase10_validation
  set activity_id = v_activity_id;
end;
$$;

reset role;
update valtrim.app_users
set role = 'READ_ONLY'
where id = (select scheduling_id from phase10_validation);

select set_config(
  'request.jwt.claim.sub',
  (select scheduling_id::text from phase10_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase10_validation%rowtype;
begin
  select * into strict v_test from phase10_validation;

  if (select count(*) from valtrim.production_activities where id = v_test.activity_id) <> 1 then
    raise exception 'READ_ONLY could not read the persisted Production activity';
  end if;

  begin
    perform valtrim.save_builder_date_configuration(
      v_test.test_builder_id,
      4::smallint,
      1::smallint,
      1::smallint
    );
    raise exception 'READ_ONLY Builder date configuration unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform valtrim.save_production_activity(
      v_test.activity_id,
      v_test.phase_id,
      v_test.lot_ids,
      '[]'::jsonb,
      null
    );
    raise exception 'READ_ONLY Production update unexpectedly succeeded';
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
    perform valtrim.save_production_activity(null, 1, array[1]::bigint[], '[]'::jsonb, null);
    raise exception 'Anonymous Production creation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;

select jsonb_build_object(
  'result', 'ok',
  'builder_defaults', '4/1/1',
  'scheduling_role', 'create-and-update',
  'production_stages', 'EXT/SHUTTER/DM/HW',
  'active_schedules', 8,
  'date_history_rows', 1,
  'rolled_back', true
) as phase10_validation;

rollback;
