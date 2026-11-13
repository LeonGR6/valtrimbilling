// Pure helpers for the email that tells Purchasing and the Job Coordinator which
// options a Purchase Order added to the Sequence Sheet: the recipients the dialog
// starts with, adding and removing them, and the messages it shows. Nothing here
// touches the network or React.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

export const MAX_EMAIL_RECIPIENTS = 10

/** What the dialog starts from: the subject and who the email is addressed to. */
export function emailDraftFromPreview(preview) {
  const draft = preview?.draft ?? {}
  const seen = new Set()
  const recipients = []
  for (const recipient of draft.recipients ?? []) {
    const email = String(recipient?.email ?? '').trim().toLowerCase()
    if (!EMAIL_PATTERN.test(email) || seen.has(email)) continue
    seen.add(email)
    recipients.push({
      email,
      role: recipient.role ?? null,
      name: recipient.name ?? '',
    })
  }

  return {
    subject: String(draft.subject ?? preview?.rendered?.subject ?? ''),
    recipients,
    missingRoles: Array.isArray(preview?.snapshot?.missingRoles)
      ? preview.snapshot.missingRoles
      : [],
  }
}

/**
 * Adds what the user typed or pasted (one address or several separated by commas,
 * semicolons or spaces) to the recipients. Addresses already there are not repeated,
 * and a bad one is reported instead of added.
 */
export function addRecipients(current, typed) {
  const known = new Set(current.map(({ email }) => email))
  const next = [...current]
  let error = ''

  const candidates = (Array.isArray(typed) ? typed : [typed])
    .flatMap((value) => String(value ?? '').split(/[\s,;]+/u))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  for (const email of candidates) {
    if (known.has(email)) continue
    if (!EMAIL_PATTERN.test(email)) {
      error = `${email} is not a valid email address.`
      continue
    }
    if (next.length >= MAX_EMAIL_RECIPIENTS) {
      error = `The email can have up to ${MAX_EMAIL_RECIPIENTS} recipients.`
      break
    }
    known.add(email)
    next.push({ email, role: null, name: '' })
  }

  return { recipients: next, error }
}

export function removeRecipient(current, email) {
  return current.filter((recipient) => recipient.email !== email)
}

export function validateRecipients(recipients) {
  if (recipients.length === 0) {
    return { success: false, error: 'Add at least one recipient.' }
  }
  if (recipients.length > MAX_EMAIL_RECIPIENTS) {
    return { success: false, error: `The email can have up to ${MAX_EMAIL_RECIPIENTS} recipients.` }
  }
  return { success: true, emails: recipients.map(({ email }) => email) }
}

/** The pairs the import reported, in the shape the email function takes. */
export function additionsFromImport(result) {
  return (result?.added ?? []).map(({ lotId, optionId, createdOption }) => ({
    lotId,
    optionId,
    createdOption,
  }))
}

export function describeOptionsEmailSent(result) {
  const recipients = result?.recipients ?? []
  return `Email sent to ${recipients.join(', ')}.`
}

/** The roles with nobody to write to, as a sentence for the dialog. */
export function describeMissingRoles(roles) {
  if (roles.length === 0) return null
  const names = roles.length > 1
    ? `${roles.slice(0, -1).join(', ')} and ${roles.at(-1)}`
    : roles[0]
  return `${names} ${roles.length > 1 ? 'have' : 'has'} no email on file. Add an email below if they should know.`
}
