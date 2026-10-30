-- The note written when a Package is created (or edited) becomes a note of the thread.
--
-- Draw, Retention Release and Price Adjustment Packages are created with an optional note, and a
-- Draft Package's note can be edited. That text lived only in draw_packages.notes, which the Package
-- page did not show as a note and which kept no author or time. Now every time that text is set or
-- changed to something non-empty, the database adds it to draw_package_notes (migration
-- 20261119120000) as the person who wrote it, at that moment, inside the same transaction:
--   AFTER INSERT                       the note of a new Package, by created_by
--   AFTER UPDATE OF notes (a change)   the new text, by updated_by; the earlier note stays in the thread
-- A write that carries no signed-in user (created_by / updated_by empty) adds no note, because a
-- note always has its author. Clearing the text adds nothing and removes nothing.
--
-- The notes that already exist are moved into the thread once, as written by who created the Package
-- and at its creation moment.

begin;

create function private.record_package_note_from_package()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_body text := nullif(btrim(coalesce(new.notes, '')), '');
  v_author_id uuid := case when tg_op = 'INSERT' then new.created_by else new.updated_by end;
begin
  if v_body is null
     or (tg_op = 'UPDATE' and v_body is not distinct from nullif(btrim(coalesce(old.notes, '')), '')) then
    return null;
  end if;

  insert into valtrim.draw_package_notes (package_id, body, created_by, author_name)
  select new.id, v_body, author.id, author.name
  from valtrim.app_users author
  where author.id = v_author_id;

  return null;
end;
$$;

revoke execute on function private.record_package_note_from_package()
  from public, anon, authenticated;

create trigger draw_packages_record_note
after insert on valtrim.draw_packages
for each row execute function private.record_package_note_from_package();

create trigger draw_packages_record_note_change
after update of notes on valtrim.draw_packages
for each row when (new.notes is distinct from old.notes)
execute function private.record_package_note_from_package();

insert into valtrim.draw_package_notes (package_id, body, created_by, author_name, created_at)
select package.id, btrim(package.notes), author.id, author.name, package.created_at
from valtrim.draw_packages package
join valtrim.app_users author on author.id = package.created_by
where nullif(btrim(coalesce(package.notes, '')), '') is not null
  and not exists (
    select 1
    from valtrim.draw_package_notes note
    where note.package_id = package.id
  );

comment on function private.record_package_note_from_package() is
  'Adds the note set on a Package at creation, or changed by an edit, to its thread of notes as its author.';

commit;
