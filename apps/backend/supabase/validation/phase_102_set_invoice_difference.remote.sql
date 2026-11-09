-- Adding, changing and removing the DIFFERENCE line of an invoiced Package against the real database, inside a
-- transaction that is rolled back. Run it after the migration 20261217120000; every row of the last result must
-- have ok = true.
--
-- It takes a real Package that waits for payment with a QuickBooks invoice, nothing paid and no difference, and
-- checks that:
--   * only the service role can run the function, and only Admin, Accounting and Draw & Invoice may be the actor,
--   * a dry run shows the totals and changes nothing,
--   * an empty text, a text of more than 100 characters, zero, three decimals, half a difference and one above
--     the limit are all refused, and the same amount is refused when the invoice already has it,
--   * a real add keeps the line on the invoice with who and when, marks the invoice as waiting for QuickBooks with
--     a new request id, removes the Release (and only the Release), leaves the Package total alone and writes
--     the INVOICE_DIFFERENCE history row,
--   * nothing else can be saved while that change waits for QuickBooks,
--   * once QuickBooks has it the line stays on the invoice, can be changed (the history says from what to what) and
--     can be taken off (all five columns go back to null),
--   * a Package that is not waiting for payment with an invoice is refused.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  actor uuid,
  stranger uuid,
  pkg bigint,
  net numeric,
  lim numeric,
  number_before text,
  request_before uuid,
  release_before integer,
  schedule_before integer,
  history_before integer,
  other_pkg bigint
) on commit drop;

create temporary table qt_out (name text primary key, outcome text) on commit drop;

create function pg_temp.attempt(p_sql text)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  execute p_sql into v_result;
  return 'ok:' || coalesce(v_result, '');
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end;
$$;

create function pg_temp.check_that(p_name text, p_ok boolean, p_detail text default null)
returns void
language sql
as $$
  insert into qt_results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function pg_temp.set_difference(p_actor uuid, p_package bigint, p_description text, p_amount numeric, p_dry boolean default false)
returns text
language sql
as $$
  select pg_temp.attempt(format(
    'select valtrim.set_invoice_difference(%L, %s, %L, %L, %L)::text',
    p_actor, p_package, p_description, p_amount, p_dry));
$$;

-- The Package under test -----------------------------------------------------------------------------------------

insert into qt_ctx (actor, stranger, pkg)
select
  (select id from valtrim.app_users
   where is_active and role::text in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')
   order by created_at limit 1),
  gen_random_uuid(),
  (select package.id
   from valtrim.draw_packages package
   join valtrim.invoices invoice on invoice.package_id = package.id and invoice.paid_amount = 0
   join valtrim.quickbooks_invoice_syncs sync
     on sync.package_id = package.id and sync.status = 'CREATED' and not sync.update_pending
        and sync.difference_amount is null and sync.qbo_invoice_id is not null
   where package.package_type = 'DRAW' and package.status = 'DRAFT'
     and package.workflow_status = 'AWAITING_PAYMENT' and package.quickbooks_status = 'CREATED'
     and invoice.net_amount > 0
     and not exists (select 1 from valtrim.invoice_payments payment where payment.invoice_id = invoice.id)
   order by
     (select count(*) from valtrim.package_documents d
      where d.package_id = package.id and d.document_type::text = 'RELEASE' and d.file_id is not null) desc,
     package.id desc
   limit 1);

update qt_ctx set
  net = (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  lim = valtrim.invoice_difference_limit((select net_amount from valtrim.invoices where package_id = qt_ctx.pkg)),
  number_before = (select invoice_number from valtrim.quickbooks_invoice_syncs where package_id = qt_ctx.pkg),
  request_before = (select update_request_id from valtrim.quickbooks_invoice_syncs where package_id = qt_ctx.pkg),
  release_before = (select count(*) from valtrim.package_documents
                    where package_id = qt_ctx.pkg and document_type::text = 'RELEASE' and file_id is not null),
  schedule_before = (select count(*) from valtrim.package_documents
                     where package_id = qt_ctx.pkg and document_type::text = 'PAYMENT_SCHEDULE'),
  history_before = (select count(*) from valtrim.draw_package_corrections
                    where package_id = qt_ctx.pkg and action = 'INVOICE_DIFFERENCE'),
  other_pkg = (select package.id from valtrim.draw_packages package
               where package.id <> qt_ctx.pkg
                 and (package.quickbooks_status <> 'CREATED' or package.workflow_status <> 'AWAITING_PAYMENT')
               order by package.id desc limit 1);

select pg_temp.check_that('There is a real Package waiting for payment with an invoice to test on',
  (select pkg is not null and actor is not null from qt_ctx),
  (select 'package ' || coalesce(pkg::text, '-') || ', net ' || coalesce(net::text, '-') || ', limit ' || coalesce(lim::text, '-')
     || ', releases ' || coalesce(release_before::text, '-') from qt_ctx));

-- Who may run it ----------------------------------------------------------------------------------------------------

select pg_temp.check_that('Only the service role can run it',
  not has_function_privilege('authenticated', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute')
  and not has_function_privilege('anon', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute')
  and has_function_privilege('service_role', 'valtrim.set_invoice_difference(uuid,bigint,text,numeric,boolean)', 'execute'));

select pg_temp.check_that('Someone who is not an active Admin, Accounting or Draw & Invoice user is refused (42501)',
  pg_temp.set_difference((select stranger from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 1) like 'err:42501:%'
  and pg_temp.set_difference(null, (select pkg from qt_ctx), 'DIFFERENCE', 1) like 'err:42501:%',
  pg_temp.set_difference((select stranger from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 1));

-- Refusals ------------------------------------------------------------------------------------------------------------

select pg_temp.check_that('Text without an amount, or an amount without text, is refused',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', null) like 'err:23514:%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), null, 2) like 'err:23514:%');

select pg_temp.check_that('An empty text, a text of 101 characters, zero and three decimals are refused',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), '   ', 1) like 'err:23514:%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), repeat('x', 101), 1) like 'err:23514:%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 0) like 'err:23514:%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 1.234) like 'err:23514:%');

select pg_temp.check_that('A difference above the limit is refused, either sign, and the limit itself is not',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', (select lim + 0.01 from qt_ctx), true) like 'err:23514:%greater than%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', (select -(lim + 0.01) from qt_ctx), true) like 'err:23514:%greater than%'
  and pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', (select lim from qt_ctx), true) like 'ok:%',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', (select lim + 0.01 from qt_ctx), true));

select pg_temp.check_that('Taking off a difference the invoice does not have is refused',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), null, null) like 'err:23514:%already has this difference%');

select pg_temp.check_that('A Package that is not waiting for payment with a QuickBooks invoice is refused',
  (select other_pkg is null from qt_ctx)
  or pg_temp.set_difference((select actor from qt_ctx), (select other_pkg from qt_ctx), 'DIFFERENCE', 1) like 'err:%',
  (select coalesce(other_pkg::text, 'no other Package to try') from qt_ctx));

-- A dry run changes nothing ---------------------------------------------------------------------------------------------

insert into qt_out
select 'dry', pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 2, true);

select pg_temp.check_that('A dry run answers with the totals and saves nothing',
  (select outcome like 'ok:%' from qt_out where name = 'dry')
  and (select (outcome::text like '%"dry_run": true%') from qt_out where name = 'dry')
  and (select difference_amount is null and not update_pending and update_request_id is not distinct from (select request_before from qt_ctx)
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx))
  and (select count(*) from valtrim.package_documents
       where package_id = (select pkg from qt_ctx) and document_type::text = 'RELEASE' and file_id is not null) = (select release_before from qt_ctx)
  and (select count(*) from valtrim.draw_package_corrections
       where package_id = (select pkg from qt_ctx) and action = 'INVOICE_DIFFERENCE') = (select history_before from qt_ctx),
  (select outcome from qt_out where name = 'dry'));

-- A real add --------------------------------------------------------------------------------------------------------------

insert into qt_out
select 'add', pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), '  DIFFERENCE  ', 2);

select pg_temp.check_that('Adding the line keeps it on the invoice with who and when, and marks the invoice as waiting for QuickBooks',
  (select outcome like 'ok:%' from qt_out where name = 'add')
  and (select difference_description = 'DIFFERENCE' and difference_amount = 2 and difference_limit = (select lim from qt_ctx)
         and difference_by = (select actor from qt_ctx) and difference_at is not null
         and update_pending and update_error is null
         and update_request_id is distinct from (select request_before from qt_ctx)
         and invoice_number is not distinct from (select number_before from qt_ctx)
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'add'));

select pg_temp.check_that('The Package total does not change and the Payment Schedule stays',
  (select net_amount = (select net from qt_ctx) from valtrim.invoices where package_id = (select pkg from qt_ctx))
  and (select count(*) from valtrim.package_documents
       where package_id = (select pkg from qt_ctx) and document_type::text = 'PAYMENT_SCHEDULE') = (select schedule_before from qt_ctx));

select pg_temp.check_that('The Release that printed the old total is removed',
  (select count(*) from valtrim.package_documents
   where package_id = (select pkg from qt_ctx) and document_type::text = 'RELEASE' and file_id is not null) = 0,
  'releases before: ' || (select release_before from qt_ctx));

select pg_temp.check_that('The answer lists the Release to remove from Storage, and the total with the line',
  (select (outcome::text like '%removed_storage_paths%')
     and (select jsonb_array_length((substr(outcome, 4)::jsonb) -> 'removed_storage_paths')) >= (select release_before from qt_ctx)
     and ((substr(outcome, 4)::jsonb) ->> 'next_total')::numeric = (select net + 2 from qt_ctx)
   from qt_out where name = 'add'),
  (select left(outcome, 300) from qt_out where name = 'add'));

select pg_temp.check_that('The history says what was added',
  (select count(*) from valtrim.draw_package_corrections
   where package_id = (select pkg from qt_ctx) and action = 'INVOICE_DIFFERENCE'
     and changed_by = (select actor from qt_ctx)
     and next_details ->> 'description' = 'DIFFERENCE' and (next_details ->> 'amount')::numeric = 2
     and previous_details ->> 'amount' is null
     and reason like 'Line "DIFFERENCE" of +$2.00 added%') = 1);

select pg_temp.check_that('Nothing else can be saved while that change waits for QuickBooks',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 1) like 'err:23514:%has not reached QuickBooks%');

-- QuickBooks takes it ---------------------------------------------------------------------------------------------------------

insert into qt_out
select 'complete', pg_temp.attempt(format(
    $q$select valtrim.complete_quickbooks_invoice_update(%s, 'tok', %s, '{}'::jsonb)::text$q$,
    (select pkg from qt_ctx), (select net + 2 from qt_ctx)));

select pg_temp.check_that('When QuickBooks has the lines the mark goes and the line stays',
  (select outcome from qt_out where name = 'complete') = 'ok:true'
  and (select not update_pending and difference_amount = 2 and total_amount = (select net + 2 from qt_ctx)
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'complete') || ' | ' || (select 'pending=' || update_pending || ' diff=' || coalesce(difference_amount::text, '-') || ' total=' || coalesce(total_amount::text, '-')
     from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)));

select pg_temp.check_that('The same line again is refused',
  pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'DIFFERENCE', 2) like 'err:23514:%already has this difference%');

-- A change -------------------------------------------------------------------------------------------------------------------

insert into qt_out
select 'change', pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), 'ROUNDING', -1.5);

select pg_temp.check_that('Changing the line replaces it and waits for QuickBooks again',
  (select outcome like 'ok:%' from qt_out where name = 'change')
  and (select difference_description = 'ROUNDING' and difference_amount = -1.5 and update_pending
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'change'));

select pg_temp.check_that('The history says from what to what',
  (select count(*) from valtrim.draw_package_corrections
   where package_id = (select pkg from qt_ctx) and action = 'INVOICE_DIFFERENCE'
     and (previous_details ->> 'amount')::numeric = 2 and previous_details ->> 'description' = 'DIFFERENCE'
     and (next_details ->> 'amount')::numeric = -1.5 and next_details ->> 'description' = 'ROUNDING'
     and reason like 'Line of the QuickBooks invoice changed from "DIFFERENCE" +$2.00 to "ROUNDING" -$1.50%') = 1);

select pg_temp.attempt(format(
  $q$select valtrim.complete_quickbooks_invoice_update(%s, 'tok2', %s, '{}'::jsonb)::text$q$,
  (select pkg from qt_ctx), (select net - 1.5 from qt_ctx)));

-- Taking it off ----------------------------------------------------------------------------------------------------------------

insert into qt_out
select 'remove', pg_temp.set_difference((select actor from qt_ctx), (select pkg from qt_ctx), null, null);

select pg_temp.check_that('Taking it off clears all five columns and waits for QuickBooks',
  (select outcome like 'ok:%' from qt_out where name = 'remove')
  and (select difference_description is null and difference_amount is null and difference_limit is null
         and difference_by is null and difference_at is null and update_pending
       from valtrim.quickbooks_invoice_syncs where package_id = (select pkg from qt_ctx)),
  (select outcome from qt_out where name = 'remove'));

select pg_temp.check_that('The history says it was taken off, and the total goes back to the Package total',
  (select count(*) from valtrim.draw_package_corrections
   where package_id = (select pkg from qt_ctx) and action = 'INVOICE_DIFFERENCE'
     and (next_details ->> 'removed')::boolean
     and (previous_details ->> 'amount')::numeric = -1.5
     and reason like 'Line "ROUNDING" of -$1.50 taken off%') = 1
  and (select ((substr(outcome, 4)::jsonb) ->> 'next_total')::numeric = (select net from qt_ctx) from qt_out where name = 'remove'));

select pg_temp.check_that('Three history rows were written in all',
  (select count(*) from valtrim.draw_package_corrections
   where package_id = (select pkg from qt_ctx) and action = 'INVOICE_DIFFERENCE') = (select history_before + 3 from qt_ctx));

select step, name, ok, detail from qt_results order by step;

rollback;
