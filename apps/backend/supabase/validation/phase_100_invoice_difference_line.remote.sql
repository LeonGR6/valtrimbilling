-- The manual DIFFERENCE line of a Package invoice against the real database, inside a transaction that is
-- rolled back. Run it after the migration 20261215120000; every row of the last result must have ok = true.
--
-- It takes two real Packages that have no QuickBooks invoice yet (and an earlier-than-a-sibling one for the
-- Release) and checks that:
--   * the limit is $5 for every $5,000 of invoice, started,
--   * an invoice cannot be recorded with a difference above its limit, with half a difference, with a zero
--     amount, with a blank text or with cents beyond two,
--   * a valid difference (the edge of the limit, plus and minus) is recorded with who and when, the Package
--     keeps it in its history, and the table itself refuses a difference above the limit,
--   * an invoice without a difference records none, and the archive keeps the difference of a cleared invoice,
--   * the Release values carry the difference of the Package and, for an earlier unpaid Package, what is owed
--     with and without it, also when QuickBooks reports a balance or a partial payment.

begin;

create temporary table qt_results (
  step serial primary key,
  name text not null,
  ok boolean not null,
  detail text
) on commit drop;

create temporary table qt_ctx (
  actor uuid,
  pkg bigint,
  pkg_net numeric,
  pkg_limit numeric,
  pkg_job bigint,
  sibling bigint,
  neg_pkg bigint,
  neg_net numeric,
  neg_limit numeric,
  plain_pkg bigint,
  plain_sibling bigint,
  plain_net numeric
) on commit drop;

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

-- The limit ----------------------------------------------------------------------------------------------------------------------

select pg_temp.check_that(
  'The limit is $5 for every $5,000 of invoice, started',
  valtrim.invoice_difference_limit(0) = 5
  and valtrim.invoice_difference_limit(0.01) = 5
  and valtrim.invoice_difference_limit(2500) = 5
  and valtrim.invoice_difference_limit(5000) = 5
  and valtrim.invoice_difference_limit(5000.01) = 10
  and valtrim.invoice_difference_limit(6700) = 10
  and valtrim.invoice_difference_limit(10000) = 10
  and valtrim.invoice_difference_limit(10000.01) = 15
  and valtrim.invoice_difference_limit(14999.99) = 15
  and valtrim.invoice_difference_limit(15000.01) = 20
  and valtrim.invoice_difference_limit(52000) = 55
  and valtrim.invoice_difference_limit(null) = 5
  and valtrim.invoice_difference_limit(-300) = 5
);

-- Three Packages that were never sent to QuickBooks ----------------------------------------------------------------------

insert into qt_ctx (actor, pkg, plain_pkg, neg_pkg)
with candidates as (
  select package.id, package.job_id, package.package_date, invoice.net_amount
  from valtrim.draw_packages package
  join valtrim.invoices invoice on invoice.package_id = package.id and invoice.net_amount > 20
  where package.package_type = 'DRAW'
    and package.status not in ('VOIDED', 'PAID')
    and package.workflow_status <> 'PAID_CLOSED'
    and package.quickbooks_status = 'NOT_CREATED'
    and not exists (select 1 from valtrim.quickbooks_invoice_syncs sync where sync.package_id = package.id)
)
select
  (select id from valtrim.app_users
   where is_active and role::text in ('ADMIN', 'ACCOUNTING', 'DRAW_INVOICE')
   order by created_at limit 1),
  -- The first has a later Package in its Job, so the Release of that one lists it as unpaid.
  (select c.id from candidates c
   where exists (
     select 1 from valtrim.draw_packages later
     where later.job_id = c.job_id and later.id <> c.id and later.package_type in ('DRAW', 'OPTIONS')
       and (later.package_date, later.id) > (c.package_date, c.id)
   )
   order by c.id limit 1),
  null,
  null;

update qt_ctx set
  neg_pkg = (select c.id from valtrim.draw_packages c
             join valtrim.invoices invoice on invoice.package_id = c.id and invoice.net_amount > 20
             where c.package_type = 'DRAW' and c.status not in ('VOIDED', 'PAID')
               and c.quickbooks_status = 'NOT_CREATED' and c.id <> qt_ctx.pkg
               and not exists (select 1 from valtrim.quickbooks_invoice_syncs s where s.package_id = c.id)
             order by c.id limit 1),
  plain_pkg = (select c.id from valtrim.draw_packages c
               join valtrim.invoices invoice on invoice.package_id = c.id and invoice.net_amount > 20
               where c.package_type = 'DRAW' and c.status not in ('VOIDED', 'PAID')
                 and c.workflow_status <> 'PAID_CLOSED'
                 and c.quickbooks_status = 'NOT_CREATED' and c.id <> qt_ctx.pkg
                 and not exists (select 1 from valtrim.quickbooks_invoice_syncs s where s.package_id = c.id)
                 and exists (
                   select 1 from valtrim.draw_packages later
                   where later.job_id = c.job_id and later.id <> c.id and later.package_type in ('DRAW', 'OPTIONS')
                     and (later.package_date, later.id) > (c.package_date, c.id)
                 )
               order by c.id desc limit 1);

update qt_ctx set
  pkg_net = (select net_amount from valtrim.invoices where package_id = qt_ctx.pkg),
  pkg_job = (select job_id from valtrim.draw_packages where id = qt_ctx.pkg),
  neg_net = (select net_amount from valtrim.invoices where package_id = qt_ctx.neg_pkg);
update qt_ctx set
  plain_net = (select net_amount from valtrim.invoices where package_id = qt_ctx.plain_pkg),
  plain_sibling = (
    select later.id from valtrim.draw_packages later, valtrim.draw_packages base
    where base.id = qt_ctx.plain_pkg and later.job_id = base.job_id and later.id <> base.id
      and later.package_type in ('DRAW', 'OPTIONS')
      and (later.package_date, later.id) > (base.package_date, base.id)
    order by later.package_date, later.id limit 1
  );
update qt_ctx set
  pkg_limit = valtrim.invoice_difference_limit(pkg_net),
  neg_limit = valtrim.invoice_difference_limit(neg_net),
  sibling = (
    select later.id from valtrim.draw_packages later, valtrim.draw_packages base
    where base.id = qt_ctx.pkg and later.job_id = base.job_id and later.id <> base.id
      and later.package_type in ('DRAW', 'OPTIONS')
      and (later.package_date, later.id) > (base.package_date, base.id)
    order by later.package_date, later.id limit 1
  );

select pg_temp.check_that(
  'Real Packages were found to test with',
  (select actor is not null and pkg is not null and neg_pkg is not null and plain_pkg is not null
     and sibling is not null and plain_sibling is not null and plain_pkg <> neg_pkg from qt_ctx),
  (select format('pkg=%s neg=%s plain=%s sibling=%s plain_sibling=%s', pkg, neg_pkg, plain_pkg, sibling, plain_sibling) from qt_ctx)
);

-- Claim the three, as the Edge Function does before calling QuickBooks ----------------------------------------------------

select valtrim.claim_quickbooks_invoice_sync(pkg, actor, 'sandbox', 'realm-test', '9990001') from qt_ctx;
select valtrim.claim_quickbooks_invoice_sync(neg_pkg, actor, 'sandbox', 'realm-test', '9990002') from qt_ctx;
select valtrim.claim_quickbooks_invoice_sync(plain_pkg, actor, 'sandbox', 'realm-test', '9990003') from qt_ctx;

create temporary table qt_out (name text primary key, outcome text) on commit drop;
-- Lines that were already in the history before this run (real tests with a sandbox invoice) are not part of it.
create temporary table qt_old_corr on commit drop as
select id from valtrim.draw_package_corrections where action = 'INVOICE_DIFFERENCE';

create function pg_temp.complete(p_package bigint, p_description text, p_amount numeric)
returns text
language sql
as $$
  select pg_temp.attempt(format(
    'select valtrim.complete_quickbooks_invoice_sync(%s, ''inv-1'', ''9990001'', ''0'', %s, ''{}''::jsonb, %s, %s, %s)::text',
    p_package,
    (select net_amount from valtrim.invoices where package_id = p_package),
    coalesce(quote_literal(p_description), 'null'),
    coalesce(p_amount::text, 'null'),
    -- A line that adds money comes with its reason (a line that takes off has none).
    case when p_amount > 0 then quote_literal('The Builder PO has a higher price') else 'null' end));
$$;

-- Refused: nothing is recorded ------------------------------------------------------------------------------------------

insert into qt_out select 'too much', pg_temp.complete(pkg, 'DIFFERENCE', -(pkg_limit + 0.01)) from qt_ctx;
insert into qt_out select 'too much, minus', pg_temp.complete(pkg, 'DIFFERENCE', -(pkg_limit + 0.01)) from qt_ctx;
insert into qt_out select 'text only', pg_temp.complete(pkg, 'DIFFERENCE', null) from qt_ctx;
insert into qt_out select 'amount only', pg_temp.complete(pkg, null, 3) from qt_ctx;
insert into qt_out select 'zero', pg_temp.complete(pkg, 'DIFFERENCE', 0) from qt_ctx;
insert into qt_out select 'three decimals', pg_temp.complete(pkg, 'DIFFERENCE', 1.005) from qt_ctx;
insert into qt_out select 'blank text', pg_temp.complete(pkg, '   ', 3) from qt_ctx;
insert into qt_out select 'long text', pg_temp.complete(pkg, repeat('x', 101), 3) from qt_ctx;

select pg_temp.check_that(
  'A difference that takes off more than the limit is refused, with a message that says the limit',
  (select outcome like 'err:23514:The difference of $%is greater than the $%allowed for an invoice of $%'
     from qt_out where name = 'too much')
  and (select outcome like 'err:23514:%' from qt_out where name = 'too much, minus'),
  (select outcome from qt_out where name = 'too much')
);

select pg_temp.check_that(
  'Half a difference, a zero amount, cents beyond two, a blank text and a long text are refused',
  (select bool_and(outcome like 'err:23514:%')
   from qt_out where name in ('text only', 'amount only', 'zero', 'three decimals', 'blank text', 'long text')),
  (select string_agg(name || '=' || outcome, '; ') from qt_out
   where name in ('text only', 'amount only', 'zero', 'three decimals', 'blank text', 'long text')
     and outcome not like 'err:23514:%')
);

insert into qt_out
select 'plus no reason', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_sync(%s, ''inv-1'', ''9990001'', ''0'', %s, ''{}''::jsonb, ''DIFFERENCE'', 500, null)::text',
  pkg, pkg_net)) from qt_ctx;
insert into qt_out
select 'plus long reason', pg_temp.attempt(format(
  'select valtrim.complete_quickbooks_invoice_sync(%s, ''inv-1'', ''9990001'', ''0'', %s, ''{}''::jsonb, ''DIFFERENCE'', 500, %L)::text',
  pkg, pkg_net, repeat('x', 501))) from qt_ctx;

select pg_temp.check_that(
  'A line that adds money is refused without a reason, and with a reason over 500 characters, whatever its size',
  (select outcome like 'err:23514:%' from qt_out where name = 'plus no reason')
  and (select outcome like 'err:23514:%' from qt_out where name = 'plus long reason'),
  (select string_agg(name || '=' || outcome, '; ') from qt_out where name like 'plus %reason')
);

select pg_temp.check_that(
  'A refused difference leaves the invoice attempt as it was: still being created, nothing recorded',
  (select sync.status = 'CREATING' and sync.difference_amount is null
     and package.quickbooks_status <> 'CREATED'
     and not exists (
       select 1 from valtrim.draw_package_corrections c
       where c.package_id = qt_ctx.pkg and c.action = 'INVOICE_DIFFERENCE' and c.id not in (select id from qt_old_corr))
   from qt_ctx
   join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.pkg
   join valtrim.draw_packages package on package.id = qt_ctx.pkg)
);

-- Accepted: the edge of the limit, plus and minus ---------------------------------------------------------------------------

insert into qt_out select 'plus edge', pg_temp.complete(pkg, '  DIFFERENCE   with Builder ', pkg_limit) from qt_ctx;
insert into qt_out select 'minus edge', pg_temp.complete(neg_pkg, 'DIFFERENCE', -neg_limit) from qt_ctx;
insert into qt_out select 'no difference', pg_temp.complete(plain_pkg, null, null) from qt_ctx;

select pg_temp.check_that(
  'A difference of exactly the limit is recorded, text cleaned, with who and when',
  (select outcome = 'ok:true' from qt_out where name = 'plus edge')
  and (select sync.status = 'CREATED'
         and sync.difference_description = 'DIFFERENCE with Builder'
         and sync.difference_amount = qt_ctx.pkg_limit
         and sync.difference_limit = qt_ctx.pkg_limit
         and sync.difference_by = qt_ctx.actor
         and sync.difference_at is not null
       from qt_ctx join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.pkg),
  (select outcome from qt_out where name = 'plus edge')
);

select pg_temp.check_that(
  'A negative difference of exactly the limit is recorded too',
  (select outcome = 'ok:true' from qt_out where name = 'minus edge')
  and (select sync.difference_amount = -qt_ctx.neg_limit
       from qt_ctx join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.neg_pkg),
  (select outcome from qt_out where name = 'minus edge')
);

select pg_temp.check_that(
  'The Package keeps the difference in its history with the text, the amount and the limit',
  (select count(*) = 1
     and bool_and(c.reason like '%DIFFERENCE with Builder%' and c.reason like '%+$%' and c.reason like '%pays more than the Package%')
     and bool_and((c.next_details ->> 'amount')::numeric = qt_ctx.pkg_limit)
     and bool_and((c.next_details ->> 'limit')::numeric = qt_ctx.pkg_limit)
     and bool_and(c.changed_by = qt_ctx.actor)
   from qt_ctx join valtrim.draw_package_corrections c
     on c.package_id = qt_ctx.pkg and c.action = 'INVOICE_DIFFERENCE' and c.id not in (select id from qt_old_corr)),
  (select string_agg(c.reason, ' | ') from valtrim.draw_package_corrections c, qt_ctx
   where c.package_id = qt_ctx.pkg and c.action = 'INVOICE_DIFFERENCE' and c.id not in (select id from qt_old_corr))
);

select pg_temp.check_that(
  'A negative line is written with its minus sign in the history',
  (select c.reason like '%-$%' from qt_ctx join valtrim.draw_package_corrections c
     on c.package_id = qt_ctx.neg_pkg and c.action = 'INVOICE_DIFFERENCE' and c.id not in (select id from qt_old_corr))
);

select pg_temp.check_that(
  'An invoice without a difference records none and writes nothing in the history',
  (select outcome = 'ok:true' from qt_out where name = 'no difference')
  and (select sync.status = 'CREATED' and sync.difference_amount is null and sync.difference_description is null
         and sync.difference_limit is null and sync.difference_by is null and sync.difference_at is null
       from qt_ctx join valtrim.quickbooks_invoice_syncs sync on sync.package_id = qt_ctx.plain_pkg)
  and not exists (
    select 1 from valtrim.draw_package_corrections c, qt_ctx
    where c.package_id = qt_ctx.plain_pkg and c.action = 'INVOICE_DIFFERENCE' and c.id not in (select id from qt_old_corr)),
  (select outcome from qt_out where name = 'no difference')
);

-- The table itself holds the line to the limit --------------------------------------------------------------------------------

insert into qt_out
select 'table above limit', pg_temp.attempt(format(
  'update valtrim.quickbooks_invoice_syncs set difference_amount = -(difference_limit + 1) where package_id = %s', pkg))
from qt_ctx;
insert into qt_out
select 'table half', pg_temp.attempt(format(
  'update valtrim.quickbooks_invoice_syncs set difference_description = null where package_id = %s', pkg))
from qt_ctx;
insert into qt_out
select 'table failed row', pg_temp.attempt(format(
  'update valtrim.quickbooks_invoice_syncs set status = ''FAILED'' where package_id = %s', pkg))
from qt_ctx;

select pg_temp.check_that(
  'The table refuses a line that takes off above its limit, half a difference, and a difference on an invoice that was not created',
  (select bool_and(outcome like 'err:23514:%')
   from qt_out where name in ('table above limit', 'table half', 'table failed row')),
  (select string_agg(name || '=' || outcome, '; ') from qt_out where name like 'table%')
);

-- The Release ---------------------------------------------------------------------------------------------------------------------

select set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true) from qt_ctx;

create function pg_temp.release_values(p_package bigint)
returns jsonb
language sql
as $$
  select private.get_package_release_values(p_package);
$$;

create function pg_temp.pending_of(p_sibling bigint, p_package bigint)
returns jsonb
language sql
as $$
  select entry
  from jsonb_array_elements(pg_temp.release_values(p_sibling) -> 'pending_packages') entry
  where (entry ->> 'package_id')::bigint = p_package;
$$;

select pg_temp.check_that(
  'The Release values of the Package carry its own difference, and a Package without one has none',
  (select (pg_temp.release_values(pkg) ->> 'difference_amount')::numeric = pkg_limit
     and pg_temp.release_values(pkg) ->> 'difference_description' = 'DIFFERENCE with Builder'
     and (pg_temp.release_values(pkg) ->> 'net_amount')::numeric = pkg_net
     and pg_temp.release_values(plain_pkg) ->> 'difference_amount' is null
   from qt_ctx)
);

-- Unpaid and untouched by QuickBooks yet: owed = the net, with the difference on top.
select pg_temp.check_that(
  'An earlier unpaid Package with a difference lists what is owed without it and with it',
  (select (e ->> 'balance_amount')::numeric = pkg_net
     and (e ->> 'balance_with_difference')::numeric = pkg_net + pkg_limit
     and (e ->> 'difference_amount')::numeric = pkg_limit
     and e ->> 'balance_source' = 'invoice'
   from qt_ctx, lateral (select pg_temp.pending_of(sibling, pkg) as e) x),
  (select pg_temp.pending_of(sibling, pkg)::text from qt_ctx)
);

-- QuickBooks reports the open invoice: its balance includes the difference.
update valtrim.quickbooks_invoice_syncs
set qbo_state = 'OPEN', qbo_total = (select pkg_net + pkg_limit from qt_ctx),
    qbo_balance = (select pkg_net + pkg_limit from qt_ctx)
where package_id = (select pkg from qt_ctx);

select pg_temp.check_that(
  'With QuickBooks showing the open invoice, owed without the difference is the net and with it the whole balance',
  (select (e ->> 'balance_amount')::numeric = pkg_net
     and (e ->> 'balance_with_difference')::numeric = pkg_net + pkg_limit
     and e ->> 'balance_source' = 'quickbooks'
   from qt_ctx, lateral (select pg_temp.pending_of(sibling, pkg) as e) x),
  (select pg_temp.pending_of(sibling, pkg)::text from qt_ctx)
);

-- Part of it was paid in QuickBooks: both figures go down by what was paid.
update valtrim.quickbooks_invoice_syncs
set qbo_state = 'PARTIALLY_PAID', qbo_balance = (select pkg_net + pkg_limit - 3 from qt_ctx)
where package_id = (select pkg from qt_ctx);

select pg_temp.check_that(
  'A partial payment lowers both what is owed without the difference and with it',
  (select (e ->> 'balance_amount')::numeric = pkg_net - 3
     and (e ->> 'balance_with_difference')::numeric = pkg_net + pkg_limit - 3
   from qt_ctx, lateral (select pg_temp.pending_of(sibling, pkg) as e) x),
  (select pg_temp.pending_of(sibling, pkg)::text from qt_ctx)
);

-- A Package without a difference answers exactly as before: the QuickBooks balance, never above the net.
update valtrim.quickbooks_invoice_syncs
set qbo_state = 'OPEN', qbo_total = (select plain_net from qt_ctx), qbo_balance = (select plain_net + 50 from qt_ctx)
where package_id = (select plain_pkg from qt_ctx);

select pg_temp.check_that(
  'A Package without a difference keeps the old rule: the QuickBooks balance, capped at the net',
  (select (e ->> 'balance_amount')::numeric = plain_net
     and e ->> 'difference_amount' is null
     and e ->> 'difference_description' is null
     and (e ->> 'balance_with_difference')::numeric = plain_net
   from qt_ctx, lateral (select pg_temp.pending_of(plain_sibling, plain_pkg) as e) x),
  (select pg_temp.pending_of(plain_sibling, plain_pkg)::text from qt_ctx)
);

update valtrim.quickbooks_invoice_syncs
set qbo_balance = (select plain_net - 10 from qt_ctx)
where package_id = (select plain_pkg from qt_ctx);

select pg_temp.check_that(
  'A Package without a difference that was partly paid owes the QuickBooks balance, with or without a difference',
  (select (e ->> 'balance_amount')::numeric = plain_net - 10
     and (e ->> 'balance_with_difference')::numeric = plain_net - 10
   from qt_ctx, lateral (select pg_temp.pending_of(plain_sibling, plain_pkg) as e) x),
  (select pg_temp.pending_of(plain_sibling, plain_pkg)::text from qt_ctx)
);

-- The archive keeps what was on the invoice --------------------------------------------------------------------------------------

select valtrim.archive_quickbooks_invoice_sync(pkg, actor, 'validation') from qt_ctx;

select pg_temp.check_that(
  'Clearing an invoice archives its difference with it',
  (select archived.difference_description = 'DIFFERENCE with Builder'
     and archived.difference_amount = qt_ctx.pkg_limit
     and archived.difference_limit = qt_ctx.pkg_limit
     and archived.difference_at is not null
   from qt_ctx join valtrim.quickbooks_invoice_sync_archive archived on archived.package_id = qt_ctx.pkg
   order by archived.archived_at desc limit 1)
);

select step, name, ok, detail from qt_results order by step;

rollback;
