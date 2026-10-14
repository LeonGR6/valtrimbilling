# Supabase Phase 10: Production Calendar

Phase 10 persists the current Production calendar and the Builder date rules
that calculate EXT, Shutter, DM and HW dates.

## Scope

- Load Production activities, selected Lots, stages, schedules and date history
  from Supabase instead of runtime demo records.
- Create or update an entire Production group atomically.
- Preserve EXT, optional Shutter, DM and HW, including Order Material,
  Install only, split divisions and Hardware Lock up.
- Persist the date owner and optional 100-character note for every schedule.
- Keep a stable database schedule id for every FullCalendar event.
- Save Builder spacing for EXT to DM, Shutter before DM and DM to HW.
- Keep the database defaults for every new Builder at 4, 1 and 1 weeks.

Customer Service and Extra / Change Orders remain outside this phase. Their
tables receive no new grants or policies, and the Extra / Change Orders UI
remains a placeholder.

## Security boundary

Active authenticated users can read the six opened Production tables subject
to RLS. Browser clients cannot insert, update or delete those tables directly
and cannot allocate Production identities.

`ADMIN`, `PROJECT_MANAGEMENT` and `SCHEDULING` can call the exposed
security-invoker RPCs. Their privileged implementations live in the unexposed
`private` schema, derive the actor from `auth.uid()`, repeat the role check and
pin an empty `search_path`.

The focused Builder-date RPC lets `SCHEDULING` change only the three calendar
spacing fields; it does not grant that role general Builder catalogue writes.
The legacy Production creator that accepts an actor id remains closed.

## Persistence rules

`save_production_activity` validates the active Phase, Job, Supervisor,
Superintendent and every selected Lot. It also enforces these stage shapes:

- EXT: one BASE schedule and optional INSTALL_ONLY;
- Shutter: one optional BASE schedule;
- DM: one BASE or at least two DIVISION schedules, plus optional INSTALL_ONLY;
- HW: one BASE or at least two DIVISION schedules, plus optional LOCK_UP.

Each required stage must cover every activity Lot exactly once. Install-only
and Lock-up schedules cover the complete Lot selection. Submitted persisted
schedule ids are updated in place; omitted schedules become inactive.

Changing a persisted schedule date or date owner writes its previous and new
date, owner and note to `production_date_history`. FullCalendar renders the
database schedule id, so edits and reloads do not create unstable event ids.

## Frontend flow

`productionActivitiesRepository.js` pages the normalized Production tables and
reloads the complete aggregate after a save. `ProductionActivitiesContext`
owns authenticated loading, errors, role capabilities and calendar-event
projection.

The calendar form serializes the current EXT, Shutter, DM and HW behavior to a
single RPC payload. Builder, community, phase, building, Lot and team display
data continue to come from persisted Jobs, Sequence Sheets, People and Builder
Contacts. Production no longer imports representative People, contacts or
calendar activities into runtime source.

## Validation

- Database structure and access:
  `apps/backend/supabase/tests/phase_10_production_calendar.test.sql`
- Remote rollback lifecycle:
  `apps/backend/supabase/validation/phase_10_production_calendar.remote.sql`
- Frontend payload and hydration:
  `apps/frontend/tests/calendar-persistence-record.test.mjs`
- Existing calendar schema and date rules:
  `apps/frontend/tests/calendar-schema.test.mjs` and
  `apps/frontend/tests/calendar-date-rules.test.mjs`
- Migration:
  `apps/backend/supabase/migrations/20260911185700_phase_10_production_calendar.sql`

Apply schema changes from the canonical migration directory with `supabase db
push`. The remote lifecycle creates a disposable Builder and a complete
five-Lot Production group, exercises the `SCHEDULING`, `READ_ONLY` and `anon`
boundaries, verifies date history, and finishes with `rollback`.
