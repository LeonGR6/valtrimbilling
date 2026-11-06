begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select ok(
  'BASEBOARD_INSTALL' = any (enum_range(null::valtrim.production_schedule_variant)::text[]),
  'Baseboard install is a schedule variant'
);

select ok(
  pg_get_functiondef('private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure)
    like '%''BASE'', ''DIVISION'', ''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP''%',
  'A saved schedule may be a Baseboard install'
);

select ok(
  pg_get_functiondef('private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure)
    like '%baseboard_count%',
  'Baseboard installs are counted per stage'
);

select ok(
  pg_get_functiondef('private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure)
    like '%''INSTALL_ONLY'', ''BASEBOARD_INSTALL'', ''LOCK_UP''%'
  and pg_get_functiondef('private.save_production_activity(bigint,bigint,bigint[],jsonb,text)'::regprocedure)
    like '%Baseboard install and Lock-up schedules must include every activity Lot%',
  'A Baseboard install must cover every Lot of the activity'
);

select ok(
  (select count(*) from valtrim.production_schedules where variant::text = 'BASEBOARD_INSTALL') >= 0,
  'The new variant can be read back'
);

select * from finish();

rollback;
