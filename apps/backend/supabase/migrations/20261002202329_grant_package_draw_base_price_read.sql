-- Draw Package detail now displays the immutable Plan Price snapshot for
-- Utility Building charges. Keep the existing column-level read boundary and
-- expose only that additional snapshot column to signed-in users.

begin;

grant select (base_price)
on valtrim.package_draws
to authenticated;

notify pgrst, 'reload schema';

commit;
