-- draw_packages uses column-level SELECT grants for signed-in users, and the
-- QuickBooks columns were never included. The app therefore could not tell
-- that a Package already has a QuickBooks invoice: it read the missing column
-- as NOT_CREATED and offered to send it again.
--
-- Both columns are plain status information (the invoice number QuickBooks
-- shows), not secrets. Row level security is unchanged.

begin;

grant select (quickbooks_status, quickbooks_reference)
on valtrim.draw_packages to authenticated;

notify pgrst, 'reload schema';

commit;
