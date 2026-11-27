-- Notes on the Plans and on the Options of a Job, kept in two threads on the Plans & Options page: what the
-- team wants to remember about the Plans ("Plan 1204 changed in the Builder's last revision") and about the
-- Options ("price pending from the vendor"). Each entry keeps who wrote it and when.
--
-- Like the notes of a Package and of a Job, a note is added and never edited or removed, so the thread stays
-- a trustworthy record, and it lives in its own table.
--
--   kind         PLANS or OPTIONS: which of the two threads of the Job the note belongs to.
--   author_name  the name of the author when the note was written (a later rename does not rewrite it).
--                The browser cannot read other users, so the name has to travel with the note.
--   created_at   set by the database, never by the browser.
--
-- Every active user can read them (they are on a page every role opens to look). ADMIN and PROJECT_MANAGEMENT,
-- who keep the Plans and Options, can add them. They are not printed on any document and not sent to QuickBooks.

begin;

create table valtrim.plan_option_notes (
  id bigint generated always as identity primary key,
  job_id bigint not null references valtrim.jobs(id) on delete restrict,
  kind text not null check (kind in ('PLANS', 'OPTIONS')),
  body varchar(1000) not null check (btrim(body) <> ''),
  created_by uuid not null references valtrim.app_users(id) on delete restrict,
  author_name varchar(100) not null check (btrim(author_name) <> ''),
  created_at timestamptz not null default now()
);

create index plan_option_notes_job_kind_date_idx
  on valtrim.plan_option_notes (job_id, kind, created_at desc, id desc);
create index plan_option_notes_author_idx
  on valtrim.plan_option_notes (created_by);

alter table valtrim.plan_option_notes enable row level security;
revoke all on table valtrim.plan_option_notes from public, anon, authenticated;
revoke all on sequence valtrim.plan_option_notes_id_seq from public, anon, authenticated;
grant select (id, job_id, kind, body, created_by, author_name, created_at)
on valtrim.plan_option_notes to authenticated;
create policy plan_option_notes_select
on valtrim.plan_option_notes for select to authenticated
using ((select private.is_active_user()));

create function private.add_plan_option_note(
  p_job_id bigint,
  p_kind text,
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
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to add Plan or Option notes'
      using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('PLANS', 'OPTIONS') then
    raise exception 'A note belongs to the Plans or to the Options'
      using errcode = '23514';
  end if;
  if v_body = '' then
    raise exception 'Write the note before saving it'
      using errcode = '23514';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'A note must contain 1000 characters or fewer'
      using errcode = '23514';
  end if;

  insert into valtrim.plan_option_notes (job_id, kind, body, created_by, author_name)
  select job.id, p_kind, v_body, author.id, author.name
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

create function valtrim.add_plan_option_note(
  p_job_id bigint,
  p_kind text,
  p_body text
)
returns bigint language sql security invoker set search_path = ''
as $$
  select private.add_plan_option_note(p_job_id, p_kind, p_body);
$$;

revoke execute on function private.add_plan_option_note(bigint, text, text)
  from public, anon, authenticated;
revoke execute on function valtrim.add_plan_option_note(bigint, text, text)
  from public, anon, authenticated;
grant execute on function private.add_plan_option_note(bigint, text, text)
  to authenticated, service_role;
grant execute on function valtrim.add_plan_option_note(bigint, text, text)
  to authenticated, service_role;

comment on table valtrim.plan_option_notes is
  'Internal notes on the Plans or the Options of a Job. Append-only: each entry keeps its author and the moment it was written.';
comment on function valtrim.add_plan_option_note(bigint, text, text) is
  'Adds an internal note to the Plans or the Options of a Job as the signed-in user. ADMIN and PROJECT_MANAGEMENT only.';
comment on policy plan_option_notes_select on valtrim.plan_option_notes is
  'Every active user can read the Plan and Option notes.';

notify pgrst, 'reload schema';
commit;
