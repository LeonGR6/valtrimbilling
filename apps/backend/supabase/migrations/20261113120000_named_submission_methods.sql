-- Four more ways a Builder Setup can say how billing is submitted: Supply Pro,
-- Textura, KB IE and KB LA.
--
-- Each is a place where the Package is uploaded, so the method already names it
-- and there is no destination to type (the Portal option keeps its optional
-- name). A named method therefore stores no destination, which also keeps a
-- name typed under another method from being saved with it.
--
-- Only the constraint changes: save_billing_setup_version passes the method
-- through, and the legacy portal_name copy is still filled for Portal only.

begin;

alter table valtrim.billing_setup_versions
  drop constraint billing_setup_versions_submission_check;

alter table valtrim.billing_setup_versions
  add constraint billing_setup_versions_submission_check
  check (
    submission_method in (
      'PORTAL', 'EMAIL', 'MAIL', 'SUPPLY_PRO', 'TEXTURA', 'KB_IE', 'KB_LA'
    )
    and (
      (
        submission_method = 'PORTAL'
        and (
          submission_destination is null
          or (
            char_length(submission_destination) between 1 and 80
            and btrim(submission_destination) = submission_destination
          )
        )
      )
      or (
        submission_method = 'EMAIL'
        and submission_destination is not null
        and char_length(submission_destination) between 1 and 254
        and btrim(submission_destination) = submission_destination
        and submission_destination
          ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
      )
      or (
        submission_method = 'MAIL'
        and submission_destination is not null
        and char_length(submission_destination) between 1 and 500
        and btrim(submission_destination) = submission_destination
      )
      or (
        submission_method in ('SUPPLY_PRO', 'TEXTURA', 'KB_IE', 'KB_LA')
        and submission_destination is null
      )
    )
  );

comment on column valtrim.billing_setup_versions.submission_method is
  'Billing submission channel: PORTAL, EMAIL, MAIL, SUPPLY_PRO, TEXTURA, KB_IE or KB_LA.';

comment on column valtrim.billing_setup_versions.submission_destination is
  'Portal name, email address or mailing address for Portal, Email and Mail; empty for Supply Pro, Textura, KB IE and KB LA, which name the destination themselves.';

notify pgrst, 'reload schema';

commit;
