-- Persist the verified Community location directly on each Job. Customer
-- Service remains frontend-only for now and may read these values in a later,
-- separately authorized integration.

begin;

alter table valtrim.jobs
  add column community_latitude numeric(9,6),
  add column community_longitude numeric(9,6);

do $$
begin
  if exists (
    select 1
    from valtrim.jobs
    where community_latitude is null or community_longitude is null
  ) then
    raise exception
      'Existing Jobs need verified Community coordinates before this migration can continue';
  end if;
end;
$$;

alter table valtrim.jobs
  alter column community_latitude set not null,
  alter column community_longitude set not null,
  add constraint jobs_community_latitude_range_check
    check (community_latitude between -90 and 90),
  add constraint jobs_community_longitude_range_check
    check (community_longitude between -180 and 180);

grant insert (community_latitude, community_longitude)
  on valtrim.jobs to authenticated;

grant update (community_latitude, community_longitude)
  on valtrim.jobs to authenticated;

comment on column valtrim.jobs.community_latitude is
  'Verified latitude of the Community or Project location for this Job.';

comment on column valtrim.jobs.community_longitude is
  'Verified longitude of the Community or Project location for this Job.';

notify pgrst, 'reload schema';

commit;
