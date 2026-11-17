-- PostgREST connects through the `authenticator` role, which preloads
-- pg_safeupdate: an UPDATE or DELETE without a WHERE clause is rejected with
-- "UPDATE requires a WHERE clause". The refresh token rotation updated the
-- single-row connection table without one, so opening a QuickBooks session
-- failed after QuickBooks had already issued the new refresh token.
--
-- The connection table holds one row (id is always true), so the new filter
-- changes nothing but the error.

begin;

create or replace function valtrim.rotate_quickbooks_refresh_token(
  p_refresh_token text,
  p_refresh_token_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret_id uuid;
begin
  if nullif(btrim(p_refresh_token), '') is null
     or char_length(p_refresh_token) > 4096 then
    raise exception 'QuickBooks returned an invalid refresh token'
      using errcode = '22023';
  end if;

  select connection.refresh_token_secret_id
  into v_secret_id
  from valtrim.quickbooks_connections connection
  for update;

  if v_secret_id is null then
    return false;
  end if;

  perform vault.update_secret(v_secret_id, p_refresh_token);

  update valtrim.quickbooks_connections connection
  set refresh_token_expires_at = coalesce(p_refresh_token_expires_at, connection.refresh_token_expires_at),
      status = 'CONNECTED',
      last_error = null
  where connection.refresh_token_secret_id = v_secret_id;

  return true;
end;
$$;

comment on function valtrim.rotate_quickbooks_refresh_token(text, timestamptz) is
  'Service-role-only: stores the refresh token QuickBooks returned on the latest refresh.';

notify pgrst, 'reload schema';

commit;
