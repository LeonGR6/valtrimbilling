-- Internal notes on a Draw & Invoice Package: a thread of entries, each kept with who wrote it and when.
--
-- A note is added and never edited or removed, so the thread stays a trustworthy record of what was
-- said about the Package. It lives in its own table: a note can be written on a Package that is
-- already issued, paid or cancelled, and the Package row itself is never touched.
--
--   author_name  the name of the author when the note was written (a later rename does not rewrite it).
--                The browser cannot read other users, so the name has to travel with the note.
--   created_at   set by the database, never by the browser.
--
-- ADMIN, ACCOUNTING and PROJECT_MANAGEMENT can add notes; every active user can read them, as they
-- can read the Package. Notes are internal: they are not printed on a generated document and are not
-- sent to QuickBooks.

begin;

create table valtrim.draw_package_notes (
  id bigint generated always as identity primary key,
  package_id bigint not null references valtrim.draw_packages(id) on delete restrict,
  body varchar(1000) not null check (btrim(body) <> ''),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  author_name varchar(100) not null check (btrim(author_name) <> ''),
  created_at timestamptz not null default now()
);

create index draw_package_notes_package_date_idx
  on valtrim.draw_package_notes (package_id, created_at desc, id desc);
create index draw_package_notes_author_idx
  on valtrim.draw_package_notes (created_by);

alter table valtrim.draw_package_notes enable row level security;
revoke all on table valtrim.draw_package_notes from public, anon, authenticated;
revoke all on sequence valtrim.draw_package_notes_id_seq from public, anon, authenticated;
grant select (id, package_id, body, created_by, author_name, created_at)
on valtrim.draw_package_notes to authenticated;
create policy draw_package_notes_select
on valtrim.draw_package_notes for select to authenticated
using ((select private.is_active_user()));

create function private.add_draw_package_note(
  p_package_id bigint,
  p_body text
)
returns bigint language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_note_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to add Package notes'
      using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Write the note before saving it'
      using errcode = '23514';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'A note must contain 1000 characters or fewer'
      using errcode = '23514';
  end if;

  insert into valtrim.draw_package_notes (package_id, body, created_by, author_name)
  select package.id, v_body, author.id, author.name
  from valtrim.draw_packages package
  cross join valtrim.app_users author
  where package.id = p_package_id
    and author.id = v_actor_id
  returning id into v_note_id;

  if v_note_id is null then
    raise exception 'The Package no longer exists'
      using errcode = 'P0002';
  end if;
  return v_note_id;
end;
$$;

create function valtrim.add_draw_package_note(
  p_package_id bigint,
  p_body text
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.add_draw_package_note(p_package_id, p_body);
$$;

revoke execute on function private.add_draw_package_note(bigint, text)
  from public, anon, authenticated;
revoke execute on function valtrim.add_draw_package_note(bigint, text)
  from public, anon, authenticated;
grant execute on function private.add_draw_package_note(bigint, text)
  to authenticated, service_role;
grant execute on function valtrim.add_draw_package_note(bigint, text)
  to authenticated, service_role;

comment on table valtrim.draw_package_notes is
  'Internal notes on a Package. Append-only: each entry keeps its author and the moment it was written.';
comment on function valtrim.add_draw_package_note(bigint, text) is
  'Adds an internal note to a Package as the signed-in user. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on policy draw_package_notes_select on valtrim.draw_package_notes is
  'Active authenticated users can read Package notes.';

notify pgrst, 'reload schema';
commit;
