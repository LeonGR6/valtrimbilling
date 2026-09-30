const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

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
