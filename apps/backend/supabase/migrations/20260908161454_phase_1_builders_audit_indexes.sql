create index builders_created_by_idx
  on valtrim.builders (created_by)
  where created_by is not null;

create index builders_updated_by_idx
  on valtrim.builders (updated_by)
  where updated_by is not null;

create index billing_setups_created_by_idx
  on valtrim.billing_setups (created_by)
  where created_by is not null;
