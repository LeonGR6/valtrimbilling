-- Internal notes on a Job: a thread of entries, each kept with who wrote it and when.
--
-- They are what the team wants at hand when it bills a Job: a call, a promise to pay, a document the
-- Builder still needs. They are shown when a Package is created, so whoever creates it sees what
-- others (or they themselves) left. A note about one Package stays with that Package
-- (valtrim.draw_package_notes); a note about the Job is kept here.
--
-- Like the notes of a Package, a note is added and never edited or removed, so the thread stays a
-- trustworthy record, and it lives in its own table.
--
--   author_name  the name of the author when the note was written (a later rename does not rewrite it).
--                The browser cannot read other users, so the name has to travel with the note.
--   created_at   set by the database, never by the browser.
--
-- ADMIN, ACCOUNTING and PROJECT_MANAGEMENT can add and read them. Unlike the notes of a Package,
-- which every active user can read, these can hold things like a promised payment date, so they are
-- not open to the other roles. They are not printed on any document and not sent to QuickBooks.

begin;

create table valtrim.job_notes (
  id bigint generated always as identity primary key,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  body varchar(1000) not null check (btrim(body) <> ''),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  author_name varchar(100) not null check (btrim(author_name) <> ''),
  created_at timestamptz not null default now()
);

create index job_notes_job_date_idx
  on valtrim.job_notes (job_id, created_at desc, id desc);
create index job_notes_author_idx
  on valtrim.job_notes (created_by);

alter table valtrim.job_notes enable row level security;
revoke all on table valtrim.job_notes from public, anon, authenticated;
revoke all on sequence valtrim.job_notes_id_seq from public, anon, authenticated;
grant select (id, job_id, body, created_by, author_name, created_at)
on valtrim.job_notes to authenticated;
create policy job_notes_select
on valtrim.job_notes for select to authenticated
using ((select private.has_app_role('ADMIN', 'ACCOUNTING', 'PROJECT_MANAGEMENT')));

create function private.add_job_note(
  p_job_id bigint,
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
    raise exception 'You do not have permission to add Job notes'
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

  insert into valtrim.job_notes (job_id, body, created_by, author_name)
  select job.id, v_body, author.id, author.name
  from valtrim.jobs job
  cross join valtrim.app_users author
  where job.id = p_job_id
    and author.id = v_actor_id
  returning id into v_note_id;

  if v_note_id is null then
    raise exception 'The Job no longer exists'
      using errcode = 'P0002';
  end if;
  return v_note_id;
end;
$$;

create function valtrim.add_job_note(
  p_job_id bigint,
  p_body text
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.add_job_note(p_job_id, p_body);
$$;

revoke execute on function private.add_job_note(bigint, text)
  from public, anon, authenticated;
revoke execute on function valtrim.add_job_note(bigint, text)
  from public, anon, authenticated;
grant execute on function private.add_job_note(bigint, text)
  to authenticated, service_role;
grant execute on function valtrim.add_job_note(bigint, text)
  to authenticated, service_role;

comment on table valtrim.job_notes is
  'Internal notes on a Job. Append-only: each entry keeps its author and the moment it was written.';
comment on function valtrim.add_job_note(bigint, text) is
  'Adds an internal note to a Job as the signed-in user. ADMIN, ACCOUNTING and PROJECT_MANAGEMENT only.';
comment on policy job_notes_select on valtrim.job_notes is
  'ADMIN, ACCOUNTING and PROJECT_MANAGEMENT can read Job notes.';

notify pgrst, 'reload schema';
commit;
