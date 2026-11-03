# Codex preferences

## Product language

- All product UI copy must be in English: labels, buttons, states, notices,
  validation and error messages, regardless of the conversation language.
- Preserve original email text and extracted evidence in their source language.
  Project documentation and conversation replies may remain in Spanish.

## Customer Service rules

- Before planning, reviewing, or changing Customer Service, read
  `docs/customer-service-business-rules.md` and follow the confirmed rules.
- That document separates current decisions, deferred work, and known gaps.
  Do not treat a documented requirement as proof that it is implemented.
- Preserve the frontend-only simulation scope unless the user authorizes an
  integration. Do not change business rules or resolve open decisions by assumption.
- When the user approves a new or changed rule, update the rules document and
  keep the related specification and tests consistent with that decision.

## Supabase environment

- This project uses the linked remote Supabase database for database validation.
- Docker and a local Supabase stack are not available. Do not run or recommend
  `supabase start`, `supabase db reset`, or database tests with `--local`.
- Run pgTAP tests against the linked remote project with `npm run db:test`.
  The project runner uses `supabase db query --linked` through the Management
  API. Do not use `supabase test db --linked`: that command still requires a
  local Docker daemon to run `pg_prove`, even though the database is remote.
- To run one database test, pass its filename, for example
  `npm run db:test -- customer_service_phase_1c.test.sql`.
- Before applying migrations, run `supabase migration list` and
  `supabase db push --dry-run`. Never edit a migration after it has been applied
  remotely; create a new migration for corrections.
