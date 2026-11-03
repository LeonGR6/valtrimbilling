-- Run only AFTER migration, function deployments and both Vault values.
-- Keeps the already verified mailbox/folder, baseline, cursor and import IDs.
select valtrim.configure_customer_service_email_automation(
  '779ebb10-fc40-4a30-9a72-639123cbb057',
  true,
  'https://lovqyhwwsettprenfrrq.supabase.co'
);
