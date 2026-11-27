begin;

-- Keep the dispatch origin in the database so every environment calculates
-- proximity from the same Valtrim office location.
alter table valtrim.service_scheduling_settings
  add column company_address varchar(240)
    check (company_address is null or btrim(company_address) <> '');

update valtrim.service_scheduling_settings
set company_address =
      '1526 Seventh St, Riverside, CA 92507, United States',
    company_latitude = 33.98658781672712,
    company_longitude = -117.3430207498169
where id = 1;

alter table valtrim.service_scheduling_settings
  alter column company_address set not null;

grant update (company_address)
  on valtrim.service_scheduling_settings to authenticated;

comment on column valtrim.service_scheduling_settings.company_address is
  'Dispatch origin displayed to coordinators and used with the stored coordinates.';
comment on column valtrim.service_scheduling_settings.distance_yellow_max_miles is
  'Upper yellow threshold. Greater distances are red warnings, never scheduling blocks.';

notify pgrst, 'reload schema';

commit;
