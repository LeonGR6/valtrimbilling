begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_column(
  'valtrim', 'jobs', 'community_latitude',
  'Jobs store the Community latitude'
);

select has_column(
  'valtrim', 'jobs', 'community_longitude',
  'Jobs store the Community longitude'
);

select col_type_is(
  'valtrim', 'jobs', 'community_latitude', 'numeric(18,15)',
  'Community latitude preserves verified coordinate precision'
);

select col_type_is(
  'valtrim', 'jobs', 'community_longitude', 'numeric(18,15)',
  'Community longitude preserves verified coordinate precision'
);

select col_not_null(
  'valtrim', 'jobs', 'community_latitude',
  'Community latitude is required'
);

select col_not_null(
  'valtrim', 'jobs', 'community_longitude',
  'Community longitude is required'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and constraint_record.conname = 'jobs_community_latitude_range_check'
  ),
  'Community latitude has a database range constraint'
);

select ok(
  exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'valtrim.jobs'::regclass
      and constraint_record.conname = 'jobs_community_longitude_range_check'
  ),
  'Community longitude has a database range constraint'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'community_latitude', 'insert')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'community_longitude', 'insert'),
  'Authorized browser inserts can provide both Community coordinates'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.jobs', 'community_latitude', 'update')
  and has_column_privilege('authenticated', 'valtrim.jobs', 'community_longitude', 'update'),
  'Authorized browser updates can change both Community coordinates'
);

select * from finish();

rollback;
