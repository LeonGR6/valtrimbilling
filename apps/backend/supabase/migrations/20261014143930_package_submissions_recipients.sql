-- A Package can now be emailed to several recipients, so `destination` holds
-- the addresses it went to, separated by commas.

begin;

alter table valtrim.package_submissions
  drop constraint package_submissions_destination_check;

alter table valtrim.package_submissions
  add constraint package_submissions_destination_check
  check (btrim(destination) <> '' and char_length(destination) <= 3000);

commit;
