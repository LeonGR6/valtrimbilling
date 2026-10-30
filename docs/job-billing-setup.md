# The billing setup of a Job

A Builder's billing setup is **versioned**. Saving it in Builder Setups never edits a version: it
creates the next one and makes it the current (ACTIVE) one; the old one becomes SUPERSEDED. A
version and its Draws are immutable.

## Which version a Job uses

- A new Job takes the Builder's ACTIVE version when it is saved (a database trigger does it).
  **Create Job** shows that setup first (retention, OCIP / WRAP, payment terms, cutoff, Draws,
  Hardware, Utility Building, documents) and asks to confirm the version before creating.
- A Job keeps its version, even when the Builder's setup changes later. Changing the Job's Builder
  gives it the new Builder's ACTIVE version.
- A Package freezes the version it was made with: its Draws, and the retention and wrap
  percentages, are copied into every line.

## Fixing the version of a Job

Wrong numbers (a 1% wrap that should be 2%) are fixed in two steps:

1. Correct the setup in **Builder Setups**: that creates a new version (for example v3).
2. In the Job's page, **Billing setup > Change setup**, choose that version. The Job keeps its
   Plans, Options, prices and Sequence Sheets.

The database function `change_job_billing_setup` (Admin and Project Management) does it, after
`preview_job_billing_setup_change` says what would stop it. It refuses when:

- the Job is inactive,
- the version is not one of the Job's Builder, is a draft, or is the one the Job already has,
- the Job has any Package that is **not voided** (voided Packages do not count),
- the new setup uses a Utility Building and some Phase has no Utility row, or it does not and the
  Job has Utility rows.

It warns, without refusing, when the number of Draws changes and the Job has confirmed Payment
Schedules, when Hardware becomes a separate price and some Plan has no Hardware price, and when
the Draw that bills the Options changes.

Every change is recorded in `job_billing_setup_changes` (who, when, from which version to which,
and the reason). Browsers cannot write `jobs.billing_setup_version_id`; only the function can.

## Not supported

- Editing a version in place.
- A setup that belongs to a single Job (different numbers than its Builder's).
- Changing the setup after the Job has a Package that is not voided: void it first.
