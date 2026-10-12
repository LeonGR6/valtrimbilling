// What a Preliminary Notice needs before it can be printed, and which blanks
// repeat the same information. Blanks are found by their printed label (see
// preliminaryNoticeFields.js), so these rules read the same on every copy of
// the form.

// Blanks that may stay empty. Every other blank must be filled to print.
// Check boxes are choices (who was served, how), so none of them is required.
// The second line of an address is optional too: those blanks are labelled
// "... (cont.)" by the detection.
export const CONTINUATION_SUFFIX = ' (cont.)'
export const OPTIONAL_FIELD_LABELS = [
  'Signature',
  'Current demand, if any, less credits / offsets',
  'Notice attachments / pages',
]

// Blanks that hold the same text: the Direct Contractor is the firm the work
// is provided for. Typing in one fills the other.
export const LINKED_FIELD_LABELS = [
  ['Direct or reputed direct contractor · Name', 'Name'],
  ['Direct or reputed direct contractor · Address', 'Address'],
]

const isFilled = (value) => typeof value === 'string' && value.trim() !== ''

export function isRequiredField(field) {
  return field.kind === 'text'
    && !OPTIONAL_FIELD_LABELS.includes(field.label)
    && !field.label.endsWith(CONTINUATION_SUFFIX)
}

/** The required blanks that are still empty, in reading order. */
export function missingRequiredFields(fields, values) {
  return fields.filter((field) => isRequiredField(field) && !isFilled(values[field.id]))
}

/**
 * For every blank that shares its text with others, the ids of the whole group
 * (itself included). A group is only formed when every label of it is on the
 * form, so an unfamiliar PDF is never linked by accident.
 */
export function linkedFieldIds(fields) {
  const groups = new Map()

  for (const labels of LINKED_FIELD_LABELS) {
    const members = labels.map((label) => fields.filter((field) => field.label === label))
    if (members.some((matches) => matches.length !== 1)) continue

    const ids = members.map(([field]) => field.id)
    for (const id of ids) groups.set(id, ids)
  }

  return groups
}

/** The values after typing `value` into a blank: its linked blanks get it too. */
export function applyFieldValue(values, links, id, value) {
  const next = { ...values }
  for (const linkedId of links.get(id) ?? [id]) next[linkedId] = value
  return next
}
