-- Phase 4: persist every Builder's versioned billing and draw setup.
--
-- The parent billing_setups row is still created only by the Builder trigger.
-- Browser clients can read completed versions, draws and required documents,
-- but all mutations go through the two audited RPCs below. Jobs, Communities,
-- Plans and downstream billing tables remain closed.

begin;

alter table valtrim.billing_setup_versions enable row level security;
alter table valtrim.billing_draws enable row level security;
alter table valtrim.billing_required_documents enable row level security;

revoke all on valtrim.billing_setup_versions from public, anon, authenticated;
revoke all on valtrim.billing_draws from public, anon, authenticated;
revoke all on valtrim.billing_required_documents from public, anon, authenticated;

grant select on valtrim.billing_setup_versions to authenticated;
grant select on valtrim.billing_draws to authenticated;
grant select on valtrim.billing_required_documents to authenticated;

create policy billing_setup_versions_select
on valtrim.billing_setup_versions for select to authenticated
using (
  status in ('ACTIVE', 'SUPERSEDED')
  and (select private.is_active_user())
);

create policy billing_draws_select
on valtrim.billing_draws for select to authenticated
using (
  (select private.is_active_user())
  and exists (
    select 1
    from valtrim.billing_setup_versions version
    where version.id = billing_draws.setup_version_id
      and version.status in ('ACTIVE', 'SUPERSEDED')
  )
);

create policy billing_required_documents_select
on valtrim.billing_required_documents for select to authenticated
using (
  (select private.is_active_user())
  and exists (
    select 1
    from valtrim.billing_setup_versions version
    where version.id = billing_required_documents.setup_version_id
      and version.status in ('ACTIVE', 'SUPERSEDED')
  )
);

create or replace function valtrim.save_builder_billing_setup(
  p_builder_id bigint,
  p_config jsonb,
  p_draws jsonb,
  p_required_documents jsonb default '[]'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_version_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Builder billing setups'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from valtrim.builders builder
    join valtrim.billing_setups setup on setup.builder_id = builder.id
    where builder.id = p_builder_id
      and builder.is_active
  ) then
    raise exception 'Select an active Builder with an initialized billing setup'
      using errcode = '23503';
  end if;

  -- The existing save function locks the Builder's parent setup, allocates the
  -- next version number and validates all draws and required documents.
  v_version_id := valtrim.save_billing_setup_version(
    p_builder_id,
    p_config,
    p_draws,
    p_required_documents,
    null,
    v_actor_id
  );

  -- Activation and superseding the previous version happen in this same
  -- transaction. A failed validation therefore leaves no partial DRAFT.
  perform valtrim.activate_billing_setup_version(v_version_id, v_actor_id);

  return v_version_id;
end;
$$;

create or replace function valtrim.deactivate_builder_billing_setup(
  p_builder_id bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_version_id bigint;
begin
  if v_actor_id is null
     or not (select private.has_app_role('ADMIN', 'PROJECT_MANAGEMENT')) then
    raise exception 'You do not have permission to change Builder billing setups'
      using errcode = '42501';
  end if;

  select version.id
  into v_version_id
  from valtrim.billing_setup_versions version
  join valtrim.billing_setups setup on setup.id = version.setup_id
  where setup.builder_id = p_builder_id
    and version.status = 'ACTIVE'
  for update of version;

  if v_version_id is null then
    raise exception 'The Builder does not have an active billing setup';
  end if;

  -- Financial configuration is historical data. Deactivation removes the
  -- current version from the catalog without deleting versions referenced by
  -- Jobs or draw packages.
  update valtrim.billing_setup_versions
  set status = 'SUPERSEDED',
      updated_at = now()
  where id = v_version_id;

  return v_version_id;
end;
$$;

revoke execute on function valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function valtrim.deactivate_builder_billing_setup(bigint)
  from public, anon, authenticated;

grant execute on function valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function valtrim.deactivate_builder_billing_setup(bigint)
  to authenticated, service_role;

comment on function valtrim.save_builder_billing_setup(bigint, jsonb, jsonb, jsonb) is
  'Creates and atomically activates a new immutable billing setup version for an active Builder. ADMIN and PROJECT_MANAGEMENT only.';

comment on function valtrim.deactivate_builder_billing_setup(bigint) is
  'Supersedes the active Builder billing setup version without deleting financial history. ADMIN and PROJECT_MANAGEMENT only.';

notify pgrst, 'reload schema';

commit;
