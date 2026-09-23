begin;

create temporary table phase11_validation (
  admin_id uuid not null,
  readonly_id uuid not null,
  phase_id bigint not null,
  lot_ids bigint[] not null,
  activity_id bigint
) on commit drop;

insert into phase11_validation (admin_id, readonly_id, phase_id, lot_ids)
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
  candidate.lot_ids
from (
  select
    phase.id as phase_id,
    (array_agg(lot.id order by lot.display_order, lot.id))[1:2] as lot_ids
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
   and superintendent.builder_id = job.builder_id
   and superintendent.is_active
  where phase.is_active
  group by phase.id
  having count(*) >= 2
  order by phase.id
  limit 1
) candidate;

grant select, update on phase11_validation to authenticated;
grant select on phase11_validation to anon;

select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase11_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase11_validation%rowtype;
  v_activity_id bigint;
  v_cancelled_id bigint;
  v_ext_schedule_id bigint;
  v_dm_schedule_id bigint;
  v_hw_schedule_id bigint;
begin
  select * into strict v_test from phase11_validation;

  select valtrim.save_production_activity(
    null,
    v_test.phase_id,
    v_test.lot_ids,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'EXT',
        'orderMaterial', false,
        'schedules', jsonb_build_array(jsonb_build_object(
          'variant', 'BASE',
          'date', '2026-09-11',
          'dateOwner', 'SUPERVISOR',
          'note', 'Phase 11 EXT.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      ),
      jsonb_build_object(
        'type', 'DM',
        'schedules', jsonb_build_array(jsonb_build_object(
          'variant', 'BASE',
          'date', '2026-10-09',
          'dateOwner', 'TENTATIVE',
          'note', 'Phase 11 DM.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      ),
      jsonb_build_object(
        'type', 'HW',
        'schedules', jsonb_build_array(jsonb_build_object(
          'variant', 'BASE',
          'date', '2026-10-16',
          'dateOwner', 'JOBSITE_SUPERINTENDENT',
          'note', 'Phase 11 HW.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      )
    ),
    'Rollback-only Phase 11 cancellation.'
  ) into v_activity_id;

  update phase11_validation
  set activity_id = v_activity_id;

  select schedule.id into strict v_ext_schedule_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'EXT'
    and schedule.variant = 'BASE';

  select schedule.id into strict v_dm_schedule_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'DM'
    and schedule.variant = 'BASE';

  select schedule.id into strict v_hw_schedule_id
  from valtrim.production_schedules schedule
  join valtrim.production_stages stage on stage.id = schedule.stage_id
  where schedule.activity_id = v_activity_id
    and stage.stage_type = 'HW'
    and schedule.variant = 'BASE';

  perform valtrim.save_production_activity(
    v_activity_id,
    v_test.phase_id,
    v_test.lot_ids,
    jsonb_build_array(
      jsonb_build_object(
        'type', 'EXT',
        'orderMaterial', false,
        'schedules', jsonb_build_array(jsonb_build_object(
          'id', v_ext_schedule_id,
          'variant', 'BASE',
          'date', '2026-09-12',
          'dateOwner', 'TENTATIVE',
          'note', 'Replacement Phase 11 EXT.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      ),
      jsonb_build_object(
        'type', 'DM',
        'schedules', jsonb_build_array(jsonb_build_object(
          'id', v_dm_schedule_id,
          'variant', 'BASE',
          'date', '2026-10-09',
          'dateOwner', 'TENTATIVE',
          'note', 'Phase 11 DM.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      ),
      jsonb_build_object(
        'type', 'HW',
        'schedules', jsonb_build_array(jsonb_build_object(
          'id', v_hw_schedule_id,
          'variant', 'BASE',
          'date', '2026-10-16',
          'dateOwner', 'JOBSITE_SUPERINTENDENT',
          'note', 'Phase 11 HW.',
          'lotIds', to_jsonb(v_test.lot_ids)
        ))
      )
    ),
    'Rollback-only Phase 11 cancellation.'
  );

  select valtrim.cancel_production_activity(v_activity_id)
  into v_cancelled_id;

  if v_cancelled_id <> v_activity_id then
    raise exception 'Cancellation returned the wrong Production activity id';
  end if;
end;
$$;

reset role;

do $$
declare
  v_test phase11_validation%rowtype;
begin
  select * into strict v_test from phase11_validation;

  if not exists (
    select 1
    from valtrim.production_activities activity
    where activity.id = v_test.activity_id
      and activity.status = 'CANCELLED'
      and activity.completed_at is null
      and activity.cancelled_at is not null
      and activity.updated_by = v_test.admin_id
  ) then
    raise exception 'Production cancellation state or audit actor was not persisted';
  end if;

  if (select count(*) from valtrim.production_activities where id = v_test.activity_id) <> 1
     or (select count(*) from valtrim.production_activity_lots where activity_id = v_test.activity_id) <> 2
     or (select count(*) from valtrim.production_stages where activity_id = v_test.activity_id) <> 3
     or (select count(*) from valtrim.production_schedules where activity_id = v_test.activity_id) <> 3
     or (select count(*) from valtrim.production_schedules where activity_id = v_test.activity_id and is_active) <> 3
     or (
       select count(*)
       from valtrim.production_date_history history
       join valtrim.production_schedules schedule on schedule.id = history.schedule_id
       where schedule.activity_id = v_test.activity_id
     ) <> 1 then
    raise exception 'Cancellation removed or modified persisted Production detail rows';
  end if;

  if not exists (
    select 1
    from valtrim.production_date_history history
    join valtrim.production_schedules schedule on schedule.id = history.schedule_id
    where schedule.activity_id = v_test.activity_id
      and history.previous_date = '2026-09-11'::date
      and history.new_date = '2026-09-12'::date
      and history.previous_note = 'Phase 11 EXT.'
      and history.new_note = 'Replacement Phase 11 EXT.'
  ) then
    raise exception 'Cancellation did not retain the Production date audit';
  end if;

  if exists (
    select 1
    from valtrim.production_activities
    where id = v_test.activity_id
      and status = 'ACTIVE'
  ) then
    raise exception 'The cancelled Production group still matches the active Calendar query';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase11_validation),
  true
);
set local role authenticated;

do $$
begin
  begin
    perform valtrim.cancel_production_activity(
      (select activity_id from phase11_validation)
    );
    raise exception 'An already cancelled Production activity was cancelled twice';
  exception
    when no_data_found then null;
  end;
end;
$$;

reset role;

select set_config(
  'request.jwt.claim.sub',
  (select readonly_id::text from phase11_validation),
  true
);
set local role authenticated;

do $$
begin
  perform valtrim.cancel_production_activity(
    (select activity_id from phase11_validation)
  );
  raise exception 'READ_ONLY unexpectedly cancelled a Production activity';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;
set local role anon;

do $$
begin
  perform valtrim.cancel_production_activity(
    (select activity_id from phase11_validation)
  );
  raise exception 'Anonymous client unexpectedly called Production cancellation';
exception
  when insufficient_privilege then null;
end;
$$;

reset role;

rollback;
