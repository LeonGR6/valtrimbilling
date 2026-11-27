begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select ok(coalesce((
  select procedure.prosecdef
    and procedure.prosrc like '%draw_package_notes%'
    and procedure.prosrc like '%new.created_by%'
    and procedure.prosrc like '%new.updated_by%'
    and procedure.prosrc like '%app_users%'
  from pg_proc procedure
  where procedure.oid = 'private.record_package_note_from_package()'::regprocedure
), false), 'The note of a Package is added to its thread as the person who wrote it');

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_record_note'
      and pg_get_triggerdef(oid) like 'CREATE TRIGGER draw_packages_record_note AFTER INSERT%'
  ),
  'A new Package adds its note after it is inserted'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'valtrim.draw_packages'::regclass
      and tgname = 'draw_packages_record_note_change'
      and pg_get_triggerdef(oid) like '%AFTER UPDATE OF notes%'
      and pg_get_triggerdef(oid) like '%IS DISTINCT FROM%'
  ),
  'An edit adds a note only when the text changed'
);

select ok(
  not has_function_privilege('anon', 'private.record_package_note_from_package()', 'execute')
  and not has_function_privilege('authenticated', 'private.record_package_note_from_package()', 'execute'),
  'Only the database adds a note this way'
);

select ok(
  not exists (
    select 1
    from valtrim.draw_packages package
    join valtrim.app_users author on author.id = package.created_by
    where nullif(btrim(coalesce(package.notes, '')), '') is not null
      and not exists (
        select 1
        from valtrim.draw_package_notes note
        where note.package_id = package.id
      )
  ),
  'Every Package that already had a note has it in its thread'
);

select ok(
  not exists (
    select 1
    from valtrim.draw_package_notes note
    where btrim(note.body) = '' or note.author_name is null
  ),
  'No note is empty or without an author'
);

select ok(
  (
    select count(*) = 4
    from pg_proc procedure
    where procedure.pronamespace = 'private'::regnamespace
      and procedure.proname in (
        'create_draw_invoice_package_with_hardware_events',
        'create_draw_invoice_package',
        'create_retention_release_package',
        'create_price_adjustment_package'
      )
      and procedure.prosrc like '%notes%'
  ),
  'Every way of creating a Package stores its note, so every one reaches the thread'
);

select * from finish();

rollback;
