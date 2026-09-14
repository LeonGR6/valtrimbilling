begin;

-- Supabase records invitation and recovery links in auth.users.last_sign_in_at.
-- Keep a separate application timestamp so "Never signed in" means that no
-- password-authenticated ValtrimBilling session has been recorded.
alter table valtrim.app_users
  add column last_password_login_at timestamptz;

comment on column valtrim.app_users.last_password_login_at is
  'Most recent password authentication recorded from the signed Supabase JWT.';

create or replace function valtrim.record_password_login()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id uuid := (select auth.uid());
  password_authenticated_at timestamptz;
  recorded_at timestamptz;
begin
  if user_id is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  select to_timestamp(max((method ->> 'timestamp')::bigint))
  into password_authenticated_at
  from jsonb_array_elements(
    coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)
  ) as method
  where method ->> 'method' = 'password';

  if password_authenticated_at is null then
    raise exception 'A password-authenticated session is required'
      using errcode = '42501';
  end if;

  update valtrim.app_users
  set last_password_login_at = password_authenticated_at
  where id = user_id
    and is_active
    and (
      last_password_login_at is null
      or last_password_login_at < password_authenticated_at
    )
  returning last_password_login_at into recorded_at;

  if recorded_at is null then
    select app_user.last_password_login_at
    into recorded_at
    from valtrim.app_users as app_user
    where app_user.id = user_id
      and app_user.is_active;
  end if;

  if recorded_at is null then
    raise exception 'An active ValtrimBilling profile is required'
      using errcode = '42501';
  end if;

  return recorded_at;
end;
$$;

revoke all on function valtrim.record_password_login()
  from public, anon, authenticated;
grant execute on function valtrim.record_password_login()
  to authenticated, service_role;

commit;
