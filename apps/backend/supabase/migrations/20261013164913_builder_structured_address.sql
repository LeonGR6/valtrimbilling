-- A Builder's address was one free-text box. It is now stored in parts (line
-- 1, line 2, city, state, ZIP code and country) so each one can be asked for,
-- validated and used on its own, e.g. in the Preliminary Notice.
--
-- The old text is kept: the column is renamed to the first address line, so
-- nothing is lost and the existing grants on it follow the rename.

begin;

alter table valtrim.builders rename column address to address_line1;

alter table valtrim.builders
  add column address_line2 varchar(120),
  add column city varchar(80),
  add column state varchar(2),
  add column zip_code varchar(10),
  add column country varchar(2) not null default 'US';

alter table valtrim.builders
  add constraint builders_state_check
    check (state is null or state ~ '^[A-Z]{2}$'),
  add constraint builders_zip_code_check
    check (zip_code is null or zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  add constraint builders_country_check
    check (country in ('US', 'MX'));

grant insert (address_line2, city, state, zip_code, country)
  on valtrim.builders to authenticated;
grant update (address_line2, city, state, zip_code, country)
  on valtrim.builders to authenticated;

notify pgrst, 'reload schema';

commit;
