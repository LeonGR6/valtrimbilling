# Release templates

A `RELEASE` Job document can be used as the Release template of its Job. This
phase classifies the Release type, detects where the variables go and stores the
mapping a person confirms. Filling the PDF is a later phase.

## Flow

1. A user uploads a PDF as a `RELEASE` Job document (existing module).
2. The user asks to use it as a template. The frontend calls
   `release-template-analyze` with `{ job_document_id }`.
3. The function stores a `needs_review` row in `valtrim.release_templates` with
   the detected type, page sizes and field suggestions.
4. The reviewer corrects the type, places a box per variable and confirms with
   the `valtrim.confirm_release_template` RPC. The previous confirmed template of
   the same Job and type becomes `superseded`.

Deleting the PDF (existing `delete_job_document` flow) deletes its template.

## Variables

| Key | Printed label | Formats |
|---|---|---|
| `through_date` | Through Date | `MM/DD/YYYY`, `MMMM D, YYYY`, `YYYY-MM-DD` |
| `check_amount` | Amount of Check, or the "received the following progress payment" line | `currency`, `plain` |
| `signature_date` | Date of Signature | same as `through_date` |

Not every form has every variable (the final-payment forms have no Through
Date; the Unconditional Final form has no check amount). A mapping needs at
least one field.

To add a variable, change `private.release_template_variables()` and the format
rule in `private.validate_release_template_mapping()` in a new migration, and
`RELEASE_VARIABLES` plus a label in `_shared/releaseFields.ts`.

## Mapping

```json
{
  "version": 1,
  "fields": [
    {
      "variable": "through_date",
      "target": { "kind": "rect", "page": 1, "x": 0.227, "y": 0.343, "w": 0.31, "h": 0.02 },
      "fontSize": 10,
      "format": "MM/DD/YYYY"
    }
  ]
}
```

Coordinates are normalized 0-1 with the origin at the top-left of the page as
displayed (after `/Rotate`). `target` is a `rect` or an `acroform` field name.
Prefer `rect`: some PDFs have a damaged AcroForm tree where only the widget
rectangles are reliable.

The database validates the mapping; the client validates it with Zod too.

## Edge function `release-template-analyze`

`POST { job_document_id: uuid, force?: boolean }`, `verify_jwt = true`.

- Roles: `ADMIN`, `ACCOUNTING`, `PROJECT_MANAGEMENT` (the Job document roles).
- The document is read with the caller's permissions (RLS). The PDF is then
  downloaded from the private bucket and the result written with the service
  role. No URLs or keys reach the browser.
- Idempotent: an existing `needs_review` template is returned unless `force`;
  `confirmed` and `superseded` are never overwritten; a run that started less
  than 3 minutes ago answers `409`; a stale or `failed` run is retried.
- Responses: `{ template, reused }`; errors are `{ error, template? }` with
  `401` not signed in, `403` wrong role, `404` document, `409` already running,
  `422` unreadable PDF, `429/502/504` OCR provider, `503` OCR not configured.

How a PDF is read:

- PDFs with a text layer (all the statutory forms so far) are read locally with
  pdf.js. The document is not sent to any other service.
- Only a PDF with almost no text on page 1 (a scan) goes to Mistral OCR
  (`mistral-ocr-latest`), first 3 pages. Its text is used in memory and never
  stored. Without a key the function answers `503` for scans.
- When the title rules cannot decide the type, a Mistral model gets the title
  lines only, with digits masked, as a tie-breaker. It is best-effort.
- Only a short public form title is kept as classification evidence. No
  document text is logged; errors are logged by class and code.

## Secrets and deploy

OCR and the tie-breaker need `MISTRAL_API_KEY`. Create the key in the Mistral
console, enable zero data retention in the account's privacy settings, then:

```text
npm run secrets:set --workspace=@valtrimbilling/backend MISTRAL_API_KEY=...
```

Deploy only this function (the `fn:deploy` script deploys all of them):

```text
cd apps/backend
npx supabase functions deploy release-template-analyze --use-api
```

Deployment bundles with full import specifiers (`npm:`, `jsr:`); the bare names
in `deno.json` are only used by local tests.

## Tests

```text
npm run fn:test    # Deno: classifier, fields, geometry, OCR/LLM clients, analysis
npm run fn:check   # type-check every function
npm run db:test    # pgTAP (needs Docker: phase_44 and phase_45)
```

`_shared/releasePdf.fixtures.test.ts` runs the real pipeline on the PDFs in
`fixtures/private/releases/` (ignored by git) and skips itself when they are
missing. Expected names: `conditional-progress.pdf`, `conditional-final.pdf`,
`unconditional-progress.pdf`, `unconditional-final.pdf` and
`prefilled-conditional-progress.pdf`.
