begin;

create temporary table phase9_validation (
  admin_id uuid not null,
  readonly_id uuid not null,
  phase_id bigint not null,
  setup_version_id bigint not null,
  options_billing_draw_number smallint,
  used_lot_ids bigint[] not null,
  available_lot_ids bigint[] not null,
  first_draw_number smallint not null,
  second_draw_number smallint not null,
  first_package_id bigint not null,
  mixed_package_id bigint
) on commit drop;

with existing_package as (
  select
    package.id as first_package_id,
    package.phase_id,
    package.setup_version_id,
    package_draw.draw_number as first_draw_number,
    array_agg(package_draw.lot_id order by package_draw.lot_number) as used_lot_ids
  from valtrim.draw_packages package
  join valtrim.package_draws package_draw
    on package_draw.package_id = package.id
  group by
    package.id,
    package.phase_id,
    package.setup_version_id,
    package_draw.draw_number
  having count(*) >= 3
), candidate as (
  select
    existing.*,
    (
      select array_agg(available_lot.id order by available_lot.lot_number)
      from (
        select lot.id, lot.lot_number
        from valtrim.lots lot
        join valtrim.billing_draws draw
          on draw.setup_version_id = existing.setup_version_id
         and draw.draw_number = existing.first_draw_number
        where lot.phase_id = existing.phase_id
          and not exists (
            select 1
            from valtrim.package_draws occupied
            where occupied.lot_id = lot.id
              and occupied.draw_id = draw.id
          )
        order by lot.lot_number
        limit 2
      ) available_lot
    ) as available_lot_ids,
    (
      select draw.draw_number
      from valtrim.billing_draws draw
      where draw.setup_version_id = existing.setup_version_id
        and draw.draw_number <> existing.first_draw_number
        and not exists (
          select 1
          from valtrim.package_draws occupied
          where occupied.draw_id = draw.id
            and occupied.lot_id = any(existing.used_lot_ids[1:3])
        )
      order by draw.draw_number
      limit 1
    ) as second_draw_number
  from existing_package existing
)
insert into phase9_validation (
  admin_id,
  readonly_id,
  phase_id,
  setup_version_id,
  options_billing_draw_number,
  used_lot_ids,
  available_lot_ids,
  first_draw_number,
  second_draw_number,
  first_package_id
)
select
  (
    select id
    from valtrim.app_users
    where role = 'ADMIN' and is_active
    order by created_at
    limit 1
  ),
  (
    select id
    from valtrim.app_users
    where role = 'READ_ONLY' and is_active
    order by created_at
    limit 1
  ),
  candidate.phase_id,
  candidate.setup_version_id,
  version.options_billing_draw_number,
  candidate.used_lot_ids,
  candidate.available_lot_ids,
  candidate.first_draw_number,
  candidate.second_draw_number,
  candidate.first_package_id
from candidate
join valtrim.billing_setup_versions version
  on version.id = candidate.setup_version_id
where cardinality(candidate.available_lot_ids) >= 2
  and candidate.second_draw_number is not null
order by candidate.first_package_id
limit 1;

grant select, update on phase9_validation to authenticated;

select set_config(
  'request.jwt.claim.sub',
  (select admin_id::text from phase9_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase9_validation%rowtype;
  v_mixed_package_id bigint;
  v_invoice record;
  v_totals record;
begin
  select * into strict v_test from phase9_validation;

  select valtrim.create_draw_invoice_package(
    v_test.phase_id,
    jsonb_build_array(
      jsonb_build_object('lot_id', v_test.available_lot_ids[1], 'draw_number', v_test.first_draw_number),
      jsonb_build_object('lot_id', v_test.available_lot_ids[2], 'draw_number', v_test.first_draw_number),
      jsonb_build_object('lot_id', v_test.used_lot_ids[1], 'draw_number', v_test.second_draw_number),
      jsonb_build_object('lot_id', v_test.used_lot_ids[2], 'draw_number', v_test.second_draw_number),
      jsonb_build_object('lot_id', v_test.used_lot_ids[3], 'draw_number', v_test.second_draw_number)
    )
  ) into v_mixed_package_id;

  if (
    select count(*)
    from valtrim.package_draws
    where package_id = v_test.first_package_id
      and lot_id = any(v_test.used_lot_ids[1:3])
      and draw_number = v_test.first_draw_number
  ) <> 3 then
    raise exception 'The existing Package does not own the first three Draw 1 cells';
  end if;

  if (
    select count(*)
    from valtrim.package_draws
    where package_id = v_mixed_package_id
  ) <> 5 then
    raise exception 'The mixed Package does not contain exactly five cells';
  end if;

  if exists (
    select 1
    from valtrim.package_draws package_draw
    where package_draw.package_id = v_mixed_package_id
      and not (
        (
          package_draw.lot_id = any(v_test.available_lot_ids[1:2])
          and package_draw.draw_number = v_test.first_draw_number
        )
        or (
          package_draw.lot_id = any(v_test.used_lot_ids[1:3])
          and package_draw.draw_number = v_test.second_draw_number
        )
      )
  ) then
    raise exception 'The mixed Package contains an unrequested Cartesian-product cell';
  end if;

  select gross_amount, retention_amount, wrap_amount, net_amount
  into strict v_invoice
  from valtrim.invoices
  where package_id = v_mixed_package_id;

  select
    sum(gross_amount)::valtrim.amount as gross_amount,
    sum(retention_amount)::valtrim.amount as retention_amount,
    sum(wrap_amount)::valtrim.amount as wrap_amount,
    sum(net_amount)::valtrim.amount as net_amount
  into strict v_totals
  from valtrim.package_draws
  where package_id = v_mixed_package_id;

  if row(
    v_invoice.gross_amount,
    v_invoice.retention_amount,
    v_invoice.wrap_amount,
    v_invoice.net_amount
  ) is distinct from row(
    v_totals.gross_amount,
    v_totals.retention_amount,
    v_totals.wrap_amount,
    v_totals.net_amount
  ) then
    raise exception 'The Invoice does not equal the five selected cell snapshots';
  end if;

  if exists (
    select 1
    from valtrim.package_options package_option
    where package_option.package_id = v_mixed_package_id
      and not exists (
        select 1
        from valtrim.package_draws package_draw
        where package_draw.package_id = package_option.package_id
          and package_draw.lot_id = package_option.lot_id
          and package_draw.draw_id = package_option.draw_id
          and package_draw.draw_number = v_test.options_billing_draw_number
      )
  ) then
    raise exception 'An Option was billed outside its selected billing-Draw cell';
  end if;

  begin
    perform valtrim.create_draw_invoice_package(
      v_test.phase_id,
      jsonb_build_array(
        jsonb_build_object(
          'lot_id', v_test.available_lot_ids[1],
          'draw_number', v_test.second_draw_number
        ),
        jsonb_build_object(
          'lot_id', v_test.available_lot_ids[1],
          'draw_number', v_test.second_draw_number
        )
      )
    );
    raise exception 'Duplicate input cells unexpectedly succeeded';
  exception
    when check_violation then null;
  end;

  begin
    perform valtrim.create_draw_invoice_package(
      v_test.phase_id,
      jsonb_build_array(
        jsonb_build_object(
          'lot_id', v_test.used_lot_ids[1],
          'draw_number', v_test.first_draw_number
        )
      )
    );
    raise exception 'A previously packaged cell was selected again';
  exception
    when unique_violation then null;
  end;

  update phase9_validation
  set mixed_package_id = v_mixed_package_id;
end;
$$;

reset role;
select set_config(
  'request.jwt.claim.sub',
  (select readonly_id::text from phase9_validation),
  true
);
set local role authenticated;

do $$
declare
  v_test phase9_validation%rowtype;
begin
  select * into strict v_test from phase9_validation;

  if (
    select count(*)
    from valtrim.draw_packages
    where id in (v_test.first_package_id, v_test.mixed_package_id)
  ) <> 2 then
    raise exception 'READ_ONLY could not read both Packages';
  end if;

  begin
    perform valtrim.create_draw_invoice_package(
      v_test.phase_id,
      jsonb_build_array(
        jsonb_build_object(
          'lot_id', v_test.available_lot_ids[1],
          'draw_number', v_test.second_draw_number
        )
      )
    );
    raise exception 'READ_ONLY Package creation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

do $$
begin
  begin
    perform valtrim.create_draw_invoice_package(
      1,
      '[{"lot_id": 1, "draw_number": 1}]'::jsonb
    );
    raise exception 'Anonymous Package creation unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;

select jsonb_build_object(
  'result', 'ok',
  'scenario', 'Lots 4-5 Draw 1 plus Lots 1-3 Draw 2',
  'rolled_back', true
) as phase9_validation;
