-- Every time a Draw Package is emailed to its Builder, one row is kept here so
-- the Package can say "Sent to ... on ...". Only the email function writes it
-- (with the service role, after it has checked the caller's role); signed-in
-- users can read it.

begin;

create table valtrim.package_submissions (
  id bigint generated always as identity primary key,
  package_id bigint not null
    references valtrim.draw_packages (id) on delete restrict,
  method text not null check (method in ('EMAIL')),
  destination text not null
    check (btrim(destination) <> '' and char_length(destination) <= 254),
  subject text not null check (char_length(subject) <= 200),
  file_name text not null check (char_length(file_name) <= 200),
  provider_message_id text,
  sent_by uuid references valtrim.app_users (id) on delete set null,
  sent_at timestamptz not null default now()
);

create index package_submissions_package_idx
  on valtrim.package_submissions (package_id, sent_at desc);

create index package_submissions_sent_by_idx
  on valtrim.package_submissions (sent_by)
  where sent_by is not null;

alter table valtrim.package_submissions enable row level security;

grant select on valtrim.package_submissions to authenticated;
grant all on table valtrim.package_submissions to service_role;
grant usage on sequence valtrim.package_submissions_id_seq to service_role;

create policy package_submissions_select
on valtrim.package_submissions for select to authenticated
using ((select private.is_active_user()));

comment on table valtrim.package_submissions is
  'Emails of a Draw Package PDF to its Builder, written by the package-submission-email function.';

notify pgrst, 'reload schema';

commit;
