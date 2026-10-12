begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select has_trigger(
  'valtrim',
  'draw_packages',
  'draw_packages_require_preliminary_notice',
  'A Package insert is checked for the Job''s Preliminary Notice'
);

select ok(
  (
    select tgtype & 2 = 2 and tgtype & 4 = 4 and tgtype & 1 = 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_require_preliminary_notice'
  ),
  'The check runs before each inserted row'
);

select ok(
  (
    select prosecdef and array_to_string(proconfig, ',') = 'search_path=""'
    from pg_proc
    where oid = 'private.require_preliminary_notice_for_first_package()'::regprocedure
  ),
  'The check uses definer rights with an empty search path'
);

select ok(
  not has_function_privilege('authenticated', 'private.require_preliminary_notice_for_first_package()', 'execute')
  and not has_function_privilege('anon', 'private.require_preliminary_notice_for_first_package()', 'execute'),
  'Signed-in users cannot call the check directly'
);

select * from finish();

rollback;
