-- QuickBooks issues a new refresh token on every refresh. If two requests
-- refresh at the same time, both start from the same stored token and the one
-- that finishes last overwrites the other's newer token. A short lease on the
-- connection row makes them take turns: only the holder refreshes and stores
-- the rotated token; everyone else waits for the release or for the lease to
-- expire (so a request that dies never blocks the connection).
--
-- The UPDATEs filter on the key column because pg_safeupdate, loaded for the
-- API roles, rejects an UPDATE or DELETE without a WHERE clause.

begin;

alter table valtrim.quickbooks_connections
  add column token_lease_owner uuid,
  add column token_lease_expires_at timestamptz;

-- Returns 'ACQUIRED', 'BUSY' (someone else holds it) or 'NOT_CONNECTED'.
create function valtrim.acquire_quickbooks_token_lease(
  p_owner uuid,
  p_seconds integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_owner is null or p_seconds is null or p_seconds not between 1 and 120 then
    raise exception 'The QuickBooks token lease needs an owner and 1 to 120 seconds'
      using errcode = '22023';
  end if;

  update valtrim.quickbooks_connections connection
  set token_lease_owner = p_owner,
      token_lease_expires_at = now() + make_interval(secs => p_seconds)
  where connection.id
    and (
      connection.token_lease_owner is null
      or connection.token_lease_expires_at <= now()
      or connection.token_lease_owner = p_owner
    );

  if found then
    return 'ACQUIRED';
  end if;

  if exists (select 1 from valtrim.quickbooks_connections connection where connection.id) then
    return 'BUSY';
  end if;

  return 'NOT_CONNECTED';
end;
$$;

-- Only the holder can release; releasing a lease that expired and was taken by
-- someone else changes nothing.
create function valtrim.release_quickbooks_token_lease(p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update valtrim.quickbooks_connections connection
  set token_lease_owner = null,
      token_lease_expires_at = null
  where connection.id
    and connection.token_lease_owner = p_owner;

  return found;
end;
$$;

revoke all on function valtrim.acquire_quickbooks_token_lease(uuid, integer)
  from public, anon, authenticated;
revoke all on function valtrim.release_quickbooks_token_lease(uuid)
  from public, anon, authenticated;
grant execute on function valtrim.acquire_quickbooks_token_lease(uuid, integer)
  to service_role;
grant execute on function valtrim.release_quickbooks_token_lease(uuid)
  to service_role;

comment on function valtrim.acquire_quickbooks_token_lease(uuid, integer) is
  'Service-role-only: takes the short lease that serializes QuickBooks refresh token rotation.';
comment on function valtrim.release_quickbooks_token_lease(uuid) is
  'Service-role-only: releases the refresh token lease held by the given owner.';

notify pgrst, 'reload schema';

commit;
