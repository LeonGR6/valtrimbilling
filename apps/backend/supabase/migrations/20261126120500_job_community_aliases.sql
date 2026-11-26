begin;

-- Other names of a Job's community, learned from Customer Service requests (decided
-- 26 Nov 2026). When an email says "KB Rancho Madrina" and the coordinator links the
-- request to Job "Rancho Madrina", she can save that name so the next email links by
-- itself. The email import and New Request still link only when exactly one Job matches
-- the extracted community, its code or one of these names.

-- 1. The Builder travels with the name, so a name belongs to one Job per Builder.
alter table valtrim.jobs
  add constraint jobs_id_builder_key unique (id, builder_id);

create table valtrim.job_community_aliases (
  id bigint generated always as identity primary key,
  job_id bigint not null,
  builder_id bigint not null,
  alias varchar(120) not null
    check (alias = btrim(alias) and char_length(alias) >= 4),
  -- The matchers' comparison key: accents removed, lower case, and each run of other
  -- characters as one space. The browser computes it; the format is checked here.
  alias_key varchar(120) not null
    check (alias_key ~ '^[a-z0-9]+( [a-z0-9]+)*$' and char_length(alias_key) >= 4),
  created_by uuid default auth.uid() references valtrim.app_users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint job_community_aliases_job_fkey foreign key (job_id, builder_id)
    references valtrim.jobs (id, builder_id) on update cascade on delete cascade,
  constraint job_community_aliases_builder_key unique (builder_id, alias_key)
);

create index job_community_aliases_job_idx on valtrim.job_community_aliases (job_id, builder_id);
create index job_community_aliases_created_by_idx on valtrim.job_community_aliases (created_by);

comment on table valtrim.job_community_aliases is
  'Other names of a Job community saved by a coordinator; unique per Builder. Imports link a Job only on a single match.';

-- 2. Every user who reads Jobs reads their names; coordinators and Job managers add or
-- remove them. Removing and adding again replaces a wrong name; there is no update.
alter table valtrim.job_community_aliases enable row level security;

revoke all on table valtrim.job_community_aliases from public, anon, authenticated;
grant select, delete on table valtrim.job_community_aliases to authenticated;
grant insert (job_id, builder_id, alias, alias_key) on valtrim.job_community_aliases to authenticated;

create policy job_community_aliases_select
on valtrim.job_community_aliases for select to authenticated
using ((select private.is_active_user()));

create policy job_community_aliases_insert
on valtrim.job_community_aliases for insert to authenticated
with check ((select private.has_app_role('ADMIN', 'SCHEDULING', 'PROJECT_MANAGEMENT')));

create policy job_community_aliases_delete
on valtrim.job_community_aliases for delete to authenticated
using ((select private.has_app_role('ADMIN', 'SCHEDULING', 'PROJECT_MANAGEMENT')));

-- 3. Audit: who saved or removed each name.
create function private.audit_job_community_alias_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed boolean := tg_op = 'DELETE';
  v_job_id bigint;
  v_alias_id bigint;
  v_builder_id bigint;
  v_alias text;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_email valtrim.email_address;
  v_actor_role text;
  v_job_label text;
begin
  if v_removed then
    v_alias_id := old.id; v_job_id := old.job_id; v_builder_id := old.builder_id; v_alias := old.alias;
  else
    v_alias_id := new.id; v_job_id := new.job_id; v_builder_id := new.builder_id; v_alias := new.alias;
  end if;

  select app_user.id, app_user.name, app_user.email, app_user.role::text
  into v_actor_id, v_actor_name, v_actor_email, v_actor_role
  from valtrim.app_users app_user
  where app_user.id = (select auth.uid());

  select job.code || ' · ' || job.community into v_job_label
  from valtrim.jobs job
  where job.id = v_job_id;

  insert into valtrim.audit_events (
    module, action, result, actor_type, actor_user_id, actor_name, actor_email, actor_role,
    entity_type, entity_id, entity_label, summary, previous_values, new_values, metadata
  )
  values (
    'JOBS',
    case when v_removed then 'JOB_COMMUNITY_ALIAS_REMOVED' else 'JOB_COMMUNITY_ALIAS_ADDED' end,
    'SUCCESS',
    case when v_actor_id is null then 'SYSTEM' else 'USER' end,
    v_actor_id, coalesce(v_actor_name, 'System'), v_actor_email, v_actor_role,
    'JOB', v_job_id::text, v_job_label,
    case when v_removed
      then format('"%s" is no longer a name of Job %s.', v_alias, coalesce(v_job_label, v_job_id::text))
      else format('"%s" was saved as a name of Job %s.', v_alias, coalesce(v_job_label, v_job_id::text))
    end,
    case when v_removed then jsonb_build_object('alias', v_alias) else '{}'::jsonb end,
    case when v_removed then '{}'::jsonb else jsonb_build_object('alias', v_alias) end,
    jsonb_build_object('aliasId', v_alias_id, 'builderId', v_builder_id)
  );

  return null;
end;
$$;

revoke all on function private.audit_job_community_alias_change() from public, anon, authenticated;

create trigger job_community_aliases_audit
after insert or delete on valtrim.job_community_aliases
for each row execute function private.audit_job_community_alias_change();

-- 4. The community the email import read for a request, after combining the email and
-- its PDF (the PDF wins). It is the name a coordinator can save for the Job she picks.
create function valtrim.read_customer_service_import_community(p_request_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(btrim(receipt.analysis_payload #>> '{structuredData,property,communityName}'), '')
  from valtrim.service_request_imports receipt
  where receipt.request_id = p_request_id
    and (select private.has_app_role('ADMIN', 'SCHEDULING'))
  order by receipt.created_at desc
  limit 1
$$;

revoke all on function valtrim.read_customer_service_import_community(bigint) from public, anon;
grant execute on function valtrim.read_customer_service_import_community(bigint) to authenticated;

commit;
