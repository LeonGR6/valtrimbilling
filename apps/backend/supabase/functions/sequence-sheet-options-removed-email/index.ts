// Tells Purchasing and the Job Coordinator which options were removed from a Sequence
// Sheet: it renders the email for review (preview) and sends it (send). The handler is
// shared with the "options added" email; see _shared/optionsEmailRequest.ts.

import { createOptionsEmailHandler } from '../_shared/optionsEmailRequest.ts'

Deno.serve(createOptionsEmailHandler('removed'))
