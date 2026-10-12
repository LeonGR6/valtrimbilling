-- A Job's first Package needs its Preliminary Notice uploaded first. Once the
-- Job has any Package, the notice was already there, so later Packages (and
-- Retention Packages) are not checked again, even if the document is deleted.
--
-- Only signed-in users are checked: the SQL editor, migrations and the service
-- role (no auth.uid()) can still load data.

begin;

create function private.require_preliminary_notice_for_first_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if exists (
    select 1
    from valtrim.draw_packages package
    where package.job_id = new.job_id
  ) or exists (
    select 1
    from valtrim.job_documents document
    where document.job_id = new.job_id
      and document.document_type = 'PRELIMINARY_NOTICE'
  ) then
    return new;
  end if;

  raise exception 'Upload the Preliminary Notice of this Job before creating its first Package'
    using errcode = '23514',
          hint = 'Open Draw & Invoice > Documents and add the Job''s Preliminary Notice PDF.';
end;
$$;

revoke execute on function private.require_preliminary_notice_for_first_package()
  from public, anon, authenticated;

create trigger draw_packages_require_preliminary_notice
before insert on valtrim.draw_packages
for each row execute function private.require_preliminary_notice_for_first_package();

comment on function private.require_preliminary_notice_for_first_package() is
  'Blocks a signed-in user from creating the first Package of a Job that has no Preliminary Notice document.';

commit;
