const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export const DEFAULT_SEQUENCE_SHEET_RECIPIENTS = [
  'amarquez@valtriminc.com',
  'dalvarez@valtriminc.com',
]

export const DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT =
  DEFAULT_SEQUENCE_SHEET_RECIPIENTS.join(', ')

export const MAX_SEQUENCE_SHEET_SUBJECT_LENGTH = 200

/**
 * The emails to review for a Sequence Sheet, as editable form values. The
 * backend proposes who each one goes to and its subject (a Job's first sheet
 * produces two emails); when it proposes nobody the usual recipients stay.
 */
export function sequenceSheetEmailDrafts(preview) {
  const proposed = Array.isArray(preview?.drafts) ? preview.drafts : []
  // Without proposed emails there is still one to send, with the usual recipients.
  const drafts = proposed.length > 0 || !preview?.rendered
    ? proposed
    : [{
      key: 'sequence-sheet',
      label: 'Sequence Sheet',
      subject: preview.rendered.subject,
      recipients: [],
    }]

  return drafts.map((draft) => {
    const emails = [...new Set(
      (draft.recipients ?? [])
        .map((recipient) => String(recipient?.email ?? '').trim().toLowerCase())
        .filter((email) => EMAIL_PATTERN.test(email)),
    )]

    return {
      key: draft.key,
      label: draft.label,
      subject: String(draft.subject ?? ''),
      recipientText: emails.length > 0
        ? emails.join(', ')
        : DEFAULT_SEQUENCE_SHEET_RECIPIENT_TEXT,
      recipientRoles: [...new Set(
        (draft.recipients ?? []).map((recipient) => recipient.role).filter(Boolean),
      )],
    }
  })
}

export function validateSequenceSheetSubject(value) {
  const subject = String(value ?? '').trim()

  if (!subject) return { success: false, error: 'Enter a subject.' }
  if (subject.length > MAX_SEQUENCE_SHEET_SUBJECT_LENGTH) {
    return {
      success: false,
      error: `Use ${MAX_SEQUENCE_SHEET_SUBJECT_LENGTH} characters or fewer.`,
    }
  }

  return { success: true, subject }
}

export function describeSequenceSheetEmailsSent(results) {
  const recipients = [...new Set(results.flatMap((result) => result.recipients ?? []))]

  return results.length > 1
    ? `${results.length} Sequence Sheet emails sent to ${recipients.join(', ')}.`
    : `Sequence Sheet emailed to ${recipients.join(', ')}.`
}

export function parseSequenceSheetRecipients(value) {
  const recipients = [...new Set(
    String(value ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )]

  if (recipients.length === 0) {
    return { success: false, error: 'Enter at least one recipient email address.' }
  }

  const invalidEmail = recipients.find((email) => !EMAIL_PATTERN.test(email))
  if (invalidEmail) {
    return { success: false, error: `${invalidEmail} is not a valid email address.` }
  }

  if (recipients.length > 10) {
    return { success: false, error: 'A Sequence Sheet email can have up to 10 recipients.' }
  }

  return { success: true, recipients }
}

export function sequenceSheetEmailPreviewDocument(html) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html { color-scheme: light; }
      body { min-width: 320px; margin: 0; background: #f8fafc; }
    </style>
  </head>
  <body>${html}</body>
</html>`
}
