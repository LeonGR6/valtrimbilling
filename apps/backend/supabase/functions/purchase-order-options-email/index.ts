// Tells Purchasing and the Job Coordinator which options a Purchase Order added to the
// Sequence Sheet: it renders the email for review (preview) and sends it (send). The
// handler is shared with the "options removed" email; see _shared/optionsEmailRequest.ts.

import { createOptionsEmailHandler } from '../_shared/optionsEmailRequest.ts'

Deno.serve(createOptionsEmailHandler('added'))
