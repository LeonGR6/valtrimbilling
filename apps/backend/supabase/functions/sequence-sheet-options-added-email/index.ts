// Tells Purchasing and the Job Coordinator which options were added to a Sequence Sheet
// by editing a Phase: it renders the email for review (preview) and sends it (send).
// The handler is shared with the other options emails; see _shared/optionsEmailRequest.ts.

import { createOptionsEmailHandler } from '../_shared/optionsEmailRequest.ts'

Deno.serve(createOptionsEmailHandler('added_manually'))
