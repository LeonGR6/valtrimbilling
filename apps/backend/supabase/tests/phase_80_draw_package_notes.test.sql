begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

select has_table(
  'valtrim',
  'draw_package_notes',
  'Packages have a table of notes'
);

select ok(
  (
    select count(*) = 6
    from information_schema.columns
    where table_schema = 'valtrim'
      and table_name = 'draw_package_notes'
      and column_name in ('id', 'package_id', 'body', 'created_by', 'author_name', 'created_at')
      and is_nullable = 'NO'
  ),
  'A note always has its Package, text, author, author name and moment'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'valtrim.draw_package_notes'::regclass),
  'Row level security is on'
);

select ok(
  has_column_privilege('authenticated', 'valtrim.draw_package_notes', 'body', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.draw_package_notes', 'author_name', 'SELECT')
  and has_column_privilege('authenticated', 'valtrim.draw_package_notes', 'created_at', 'SELECT'),
  'Signed-in users read the text, the author and the moment'
);

select ok(
  not has_table_privilege('authenticated', 'valtrim.draw_package_notes', 'INSERT')
  and not has_table_privilege('authenticated', 'valtrim.draw_package_notes', 'UPDATE')
  and not has_table_privilege('authenticated', 'valtrim.draw_package_notes', 'DELETE')
  and not has_table_privilege('anon', 'valtrim.draw_package_notes', 'SELECT'),
  'The browser cannot write, edit or delete a note, and anonymous users cannot read them'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'valtrim'
      and tablename = 'draw_package_notes'
      and cmd = 'SELECT'
      and qual like '%is_active_user%'
  ),
  'Active users read notes under the same rule as the Package'
);

select ok(coalesce((
  select procedure.prosecdef
    and procedure.prosrc like '%has_app_role(''ADMIN'', ''ACCOUNTING'', ''PROJECT_MANAGEMENT'')%'
    and procedure.prosrc like '%(select auth.uid())%'
    and procedure.prosrc like '%author.name%'
    and procedure.prosrc like '%char_length(v_body) > 1000%'
  from pg_proc procedure
  where procedure.oid = 'private.add_draw_package_note(bigint,text)'::regprocedure
), false), 'Only the three roles add a note, as the signed-in user, with their name and a length limit');

select ok(
  has_function_privilege('authenticated', 'valtrim.add_draw_package_note(bigint,text)', 'execute')
  and not has_function_privilege('anon', 'valtrim.add_draw_package_note(bigint,text)', 'execute')
  and not has_function_privilege('anon', 'private.add_draw_package_note(bigint,text)', 'execute'),
  'Signed-in users call the function; anonymous users cannot'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'valtrim.draw_package_notes'::regclass
      and contype = 'f'
      and confrelid = 'valtrim.draw_packages'::regclass
      and confdeltype = 'r'
  ),
  'A Package with notes cannot be deleted from under them'
);

select ok(
  not exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_package_notes'::regclass
      and not tgisinternal
  ) and not exists (
    select 1
    from pg_proc procedure
    where procedure.pronamespace in ('valtrim'::regnamespace, 'private'::regnamespace)
      and procedure.prosrc ~* 'update\s+valtrim\.draw_package_notes'
  ),
  'No function edits a note after it was written'
);

select * from finish();

rollback;
