-- User-authorized (6 Nov 2026), plan docs/jobs-and-customer-service-reset-plan.md, block 3.
-- Registers the three builders the real Jobs need and that do not exist yet.
-- A Job requires an ACTIVE billing setup version and an active Jobsite
-- Superintendent of its builder. The user approved TEST placeholders for both:
-- the billing copies the current Tri Pointe Inland Empire setup (two 50% draws,
-- monthly, cutoff day 20, submission day 25, net 30). Each Job keeps the version
-- that was active when it was created, so Jobs created on these TEST versions
-- stay on them after a real version is activated.
begin;

do $builders$
declare
  v_builder record;
  v_builder_id bigint;
  v_setup_id bigint;
  v_version_id bigint;
begin
  if exists (
    select 1 from valtrim.builders
    where code in ('PUL', 'TB', 'HVH')
       or lower(name) in ('pulte homes', 'toll brothers', 'hill view homes')
  ) then
    raise exception 'Pulte Homes, Toll Brothers or Hill View Homes already exists; nothing was created';
  end if;

  for v_builder in
    select * from (values
      ('PUL', 'Pulte Homes', 'pulte', 'Pulte'),
      ('TB', 'Toll Brothers', 'toll', 'Toll'),
      ('HVH', 'Hill View Homes', 'hillview', 'Hill View')
    ) as builder(code, name, email_key, short_name)
  loop
    -- builders_initialize_billing creates the billing setup on insert.
    insert into valtrim.builders (code, name, is_active)
    values (v_builder.code, v_builder.name, true)
    returning id into v_builder_id;

    select id into strict v_setup_id from valtrim.billing_setups where builder_id = v_builder_id;

    insert into valtrim.billing_setup_versions (
      setup_id, builder_id, version_number, status, frequency, cutoff_day, submission_day,
      payment_terms_days, notes
    ) values (
      v_setup_id, v_builder_id, 1, 'DRAFT', 'MONTHLY', 20, 25, 30,
      'TEST DATA - Temporary billing setup copied from Tri Pointe Homes Inland Empire. Replace before production use.'
    ) returning id into v_version_id;

    insert into valtrim.billing_draws (setup_version_id, draw_number, name, percentage)
    values (v_version_id, 1, 'draw 1', 50.00), (v_version_id, 2, 'draw 2', 50.00);

    -- The same activation the app uses; it validates the draws.
    perform valtrim.activate_billing_setup_version(v_version_id, null);

    insert into valtrim.builder_contacts (builder_id, name, type, email, notes, is_active)
    values (
      v_builder_id,
      format('[TEST] %s Superintendent', v_builder.short_name),
      'JOBSITE_SUPERINTENDENT',
      format('test.%s.superintendent@valtrim.invalid', v_builder.email_key),
      'TEST DATA - Temporary superintendent for development. Replace before production use.',
      true
    );
  end loop;
end;
$builders$;

commit;
