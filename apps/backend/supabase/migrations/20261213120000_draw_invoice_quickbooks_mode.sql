-- The Draw & Invoice role can change the QuickBooks mode (Test or Production) that new invoices go to.
--
-- Until now only ADMIN could, so a Draw & Invoice user sent a Package to whatever mode someone else had left on.
-- Connecting or reconnecting an environment to Intuit stays with ADMIN (quickbooks-oauth-start): the role only
-- chooses between the two that are already connected.
--
-- The role list lives inside the body of private.set_quickbooks_active_environment, so it is swapped in place (the
-- way 20261125120000 and 20261212120000 did it): the function is read back with pg_get_functiondef, only the list of
-- its has_app_role call and the sentence of its error change, and it is created again. The migration stops (and rolls
-- back) if the function does not hold exactly what is expected, or does not hold the new list afterwards.

begin;

do $mode$
declare
  v_oid oid := 'private.set_quickbooks_active_environment(text)'::regprocedure;
  v_definition text := pg_get_functiondef(v_oid);
  v_swapped text;
begin
  if v_definition not like '%has_app_role(''ADMIN'')%'
     or v_definition not like '%Only an administrator can change the QuickBooks mode%' then
    raise exception 'private.set_quickbooks_active_environment does not hold the ADMIN only check this migration expects';
  end if;

  v_swapped := replace(
    replace(
      v_definition,
      'has_app_role(''ADMIN'')',
      'has_app_role(''ADMIN'', ''DRAW_INVOICE'')'
    ),
    'Only an administrator can change the QuickBooks mode',
    'Only an administrator or a Draw & Invoice user can change the QuickBooks mode'
  );

  execute v_swapped;

  v_definition := pg_get_functiondef(v_oid);
  if v_definition not like '%has_app_role(''ADMIN'', ''DRAW_INVOICE'')%'
     or v_definition like '%has_app_role(''ADMIN'')%' then
    raise exception 'private.set_quickbooks_active_environment does not name ADMIN and DRAW_INVOICE after the change';
  end if;
end;
$mode$;

comment on function valtrim.set_quickbooks_active_environment(text)
  is 'ADMIN and DRAW_INVOICE only: chooses where new QuickBooks invoices go (sandbox or production). Needs that environment connected.';

commit;
