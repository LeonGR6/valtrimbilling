begin;

do $$
declare
  v_admin_id uuid;
  v_connection_user_id uuid;
  v_secret_id uuid;
  v_decrypted_token text;
begin
  if not (select relrowsecurity from pg_class where oid =
    'valtrim.google_oauth_states'::regclass)
     or not (select relrowsecurity from pg_class where oid =
       'valtrim.google_calendar_connections'::regclass) then
    raise exception 'Phase 12 OAuth tables must have RLS enabled';
  end if;

  if has_table_privilege(
    'authenticated',
    'valtrim.google_oauth_states',
    'select'
  ) then
    raise exception 'Authenticated clients can read OAuth states';
  end if;

  if has_column_privilege(
    'authenticated',
    'valtrim.google_calendar_connections',
    'refresh_token_secret_id',
    'select'
  ) then
    raise exception 'Authenticated clients can read the Vault secret reference';
  end if;

  if has_function_privilege(
    'authenticated',
    'valtrim.complete_google_calendar_connection(uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'Authenticated clients can call the Vault writer';
  end if;

  select app_user.id
  into v_admin_id
  from valtrim.app_users app_user
  where app_user.is_active
    and app_user.role = 'ADMIN'
  order by app_user.created_at
  limit 1;

  if v_admin_id is null then
    raise exception 'Remote validation needs one active ADMIN profile';
  end if;

  insert into valtrim.google_oauth_states (
    state_hash,
    user_id,
    expires_at
  ) values (
    repeat('a', 64),
    v_admin_id,
    now() + interval '10 minutes'
  );

  select valtrim.complete_google_calendar_connection(
    v_admin_id,
    'phase12-validation@group.calendar.google.com',
    'ValtrimBilling OAuth Validation',
    'phase-12-validation-refresh-token',
    'https://www.googleapis.com/auth/calendar.app.created'
  ) into v_connection_user_id;

  if v_connection_user_id is distinct from v_admin_id then
    raise exception 'Connection completion returned the wrong user';
  end if;

  select connection.refresh_token_secret_id
  into v_secret_id
  from valtrim.google_calendar_connections connection
  where connection.user_id = v_admin_id
    and connection.google_calendar_id =
      'phase12-validation@group.calendar.google.com'
    and connection.status = 'CONNECTED';

  if v_secret_id is null then
    raise exception 'Connection completion did not persist its metadata';
  end if;

  select secret.decrypted_secret
  into v_decrypted_token
  from vault.decrypted_secrets secret
  where secret.id = v_secret_id;

  if v_decrypted_token is distinct from 'phase-12-validation-refresh-token' then
    raise exception 'The refresh token was not encrypted in Vault correctly';
  end if;
end;
$$;

rollback;

select 'phase_12_google_calendar_oauth_remote_ok' as result;
