# Bulk edit of Plans & Options

The Plans & Options page of a Job has a **Bulk edit** mode for Jobs with many Options: one grid to add,
edit and delete Plans and Options, saved all at once. It takes the place of the list until it is saved
or left, with a bar that says what saving would do.

## In the page

- The grid starts with what the Job has: a row for each Plan (code and name), then a row for each of its
  Options (OPT # and description). Edit any cell; the row is marked as edited, says what it was, and
  has an undo button.
- Tick rows and press **Delete selected** to mark them for deletion (a Plan takes its Options with it).
  They stay in the grid, struck through, until saved, and can be kept with the undo button. A Plan or
  Option that Lots use has a lock and cannot be ticked.
- Below, **New rows** to add: one Option per row (Plan, OPT #, Description and an optional Plan name).
  A blank Plan takes the Plan above; a Plan that the Job has gets the Option added to it, and a Plan it
  does not have is created. A row with only a Plan creates (or finds) the Plan. Blank Description: the
  OPT # is used.
- Enter and the arrow keys move through a column; a block copied from a spreadsheet is pasted into the
  new rows from the cell it lands on (a first line of column names is left out).
- An Option is edited, not moved: its Plan cannot be changed. Prices are not changed here (Plan Pricing).
- Saving asks first when something is being deleted, and is blocked while a row has to be fixed.

The rules are in `apps/frontend/src/features/jobs/utils/bulkPlanOptions.js`; which Plans and Options Lots
use, in `utils/planUsage.js`.

## In the database

`valtrim.apply_plan_option_changes(p_job_id, p_changes)` (migration `20261103120000`) saves everything in
one transaction, for Admin and Project Management; any invalid change rolls everything back.
`p_changes` has these lists (all optional, at most 3000 changes):

- `new_plans`: `[{ code, name, options: [{ code, description }] }]` Plans to create; a deleted (inactive)
  Plan with the same code is brought back, as the single "Add plan" does.
- `option_adds`: `[{ plan_id, code, description }]` Options for Plans that exist; one the Plan already has
  (same OPT # and description) is skipped.
- `plan_updates`: `[{ id, code, name }]`. Codes are moved aside first, so two Plans can swap codes. A Plan
  code is not repeated in the Job (a deleted Plan keeps its code).
- `option_updates`: `[{ id, code, description }]`.
- `deleted_plans` / `deleted_options`: ids. A Plan or Option that a Lot uses cannot be deleted. Deleting
  means deactivating, so nothing is lost; a deleted Plan's Options go with it.

Changing a Plan's code does not touch its Lots, which point to the Plan, not to its code.
