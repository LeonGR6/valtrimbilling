-- Every Package of a Job needs the Job's Preliminary Notice, not only the first.
--
-- Until now the check stopped once a Job had any Package, so deleting the notice
-- afterwards (or a Job whose notice was never filled in) could still be billed.
-- Now a signed-in user cannot create a Package, Retention Release included, for a
-- Job that has no Preliminary Notice document.
--
-- Only signed-in users are checked: the SQL editor, migrations and the service
-- role (no auth.uid()) can still load data.

begin;

create function private.require_preliminary_notice_for_package()
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
    from valtrim.job_documents document
    where document.job_id = new.job_id
      and document.document_type = 'PRELIMINARY_NOTICE'
  ) then
    return new;
  end if;

  raise exception 'Fill in the Preliminary Notice of this Job before creating a Package'
    using errcode = '23514',
          hint = 'Open Draw & Invoice > Documents and fill in the Job''s Preliminary Notice.';
end;
$$;

revoke execute on function private.require_preliminary_notice_for_package()
  from public, anon, authenticated;

drop trigger draw_packages_require_preliminary_notice on valtrim.draw_packages;

create trigger draw_packages_require_preliminary_notice
before insert on valtrim.draw_packages
for each row execute function private.require_preliminary_notice_for_package();

drop function private.require_preliminary_notice_for_first_package();

comment on function private.require_preliminary_notice_for_package() is
  'Blocks a signed-in user from creating a Package for a Job that has no Preliminary Notice document.';

notify pgrst, 'reload schema';

commit;
