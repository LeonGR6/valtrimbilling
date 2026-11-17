-- Every 30 minutes, ask QuickBooks how the open Package invoices stand.
--
-- pg_cron wakes up `private.run_quickbooks_payments_sync()`, which calls the
-- `quickbooks-payments-sync` Edge Function with `{"all": true}` and the shared
-- secret in `x-cron-secret`. The URL and the secret are NOT in this file: each
-- environment keeps them in Vault, under these names, and the same secret must
-- be set as the function's QUICKBOOKS_SYNC_CRON_SECRET:
--
--   quickbooks_sync_function_url     https://<project-ref>.supabase.co/functions/v1/quickbooks-payments-sync
--   quickbooks_sync_cron_secret      a long random string
--
-- Without them the job does nothing, so this migration is safe everywhere.

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function private.run_quickbooks_payments_sync()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'quickbooks_sync_function_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'quickbooks_sync_cron_secret';

  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('all', true),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.run_quickbooks_payments_sync()
  from public, anon, authenticated;

select cron.schedule(
  'quickbooks-payments-sync',
  '*/30 * * * *',
  'select private.run_quickbooks_payments_sync()'
);

commit;
