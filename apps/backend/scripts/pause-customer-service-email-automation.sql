-- Stops future scheduled calls and rejects queued, unconsumed invocations.
-- An already running source/worker may finish. No queue/checkpoint is cleared.
select valtrim.configure_customer_service_email_automation(
  '779ebb10-fc40-4a30-9a72-639123cbb057',
  false,
  'https://lovqyhwwsettprenfrrq.supabase.co'
);
