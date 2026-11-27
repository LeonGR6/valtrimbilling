begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select has_function('private', 'get_final_release_status', array['bigint'],
  'The Final Release status of a Package is still answered by one function');

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%v_retention_scope = ''JOB'' and v_scope = ''PROJECT''%'
  and pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%v_retention_scope = ''BUILDING'' and v_scope = ''BUILDING''%',
  'Retention is released at the Final level for Per Job with Project and Per Building with Building'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%pinned.retention_enabled and pinned.retention_percentage > 0%',
  'Only a setup that really retains something moves the Final to the Retention Release'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%v_package.package_type = ''RETENTION_RELEASE'' and v_retention_final%'
  and pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%''is_final'', true%',
  'A Retention Release at that level is the Final'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%not v_retention_final%',
  'A Draw Package is never the Final while the Retention Release is'
);

select ok(
  pg_get_functiondef('private.get_final_release_status(bigint)'::regprocedure)
    like '%''reason'', v_package.package_type%',
  'Packages that are not Draw Packages and not that Retention Release still have no Release'
);

select * from finish();

rollback;
