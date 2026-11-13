import { calendarEventSchema } from '../schemas/calendarEventSchema.js'
import { findSplitCoverageIssue } from './splitLotGroups.js'

// Where an error belongs in the Production form.
//
// A form error is `{ key, label, message }`:
//  - `key` is the field or section it belongs to (see FIELD_ORDER), or null when it belongs to the
//    save as a whole (permissions, a lost connection). The form puts `data-error-key` on the
//    field, so the key is also how it finds the field to scroll to and focus.
//  - `label` names the field the way the form does ("DM date"), for the list next to Save.
//  - `message` says what is wrong and, when it can, how to fix it.

const STAGE_NAMES = { ext: 'EXT', dm: 'DM', hw: 'HW' }

// Top to bottom, as the fields are laid out in the form.
const FIELD_ORDER = [
  'jobId',
  'phaseId',
  'extDate',
  'extInstallDate',
  'shutterDate',
  'dmDate',
  'dmInstallDate',
  'dmBaseboardInstallDate',
  'dmSplitParts',
  'hwDate',
  'hwLockUpDate',
  'hwSplitParts',
  'notes',
]

const FIELD_LABELS = {
  jobId: 'Job',
  phaseId: 'Phase',
  extDate: 'EXT date',
  extInstallDate: 'EXT install-only date',
  shutterDate: 'Shutter date',
  dmDate: 'DM date',
  dmInstallDate: 'DM install-only date',
  dmBaseboardInstallDate: 'DM baseboard install date',
  dmSplitParts: 'DM split schedule',
  hwDate: 'HW date',
  hwLockUpDate: 'Hardware lock-up date',
  hwSplitParts: 'HW split schedule',
  notes: 'General production notes',
}

// What the Job and the Phase carry into the activity: when one of those is wrong the fix is to
// choose the Job or the Phase again, so that is where the error is shown.
const JOB_FIELDS = new Set(['jobId', 'jobCode', 'builder', 'community'])
const PHASE_FIELDS = new Set([
  'phaseId',
  'phase',
  'building',
  'lotStart',
  'lotEnd',
  'lotNumbers',
  'lotIds',
])
// An owner, a note or a history belongs to the date it comes with.
const DATE_COMPANION = /(Owner|Note|History)$/
const SPLIT_PARTS = /^(dm|hw)SplitParts$/
const DIVISION_FIELD_ORDER = { lotStart: 0, lotEnd: 1, date: 2 }

function pathToKey(path) {
  const [head, index, leaf] = path
  if (JOB_FIELDS.has(head)) return 'jobId'
  if (PHASE_FIELDS.has(head)) return 'phaseId'

  if (SPLIT_PARTS.test(head)) {
    if (path.length === 1) return head
    // Owner, note and the rest of a division sit under its date.
    const field = leaf === 'lotStart' || leaf === 'lotEnd' ? leaf : 'date'
    return `${head}.${index}.${field}`
  }

  const key = String(head).replace(DATE_COMPANION, '')
  return FIELD_ORDER.includes(key) ? key : null
}

function describeKey(key) {
  if (!key) return 'Production details'
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]

  const [partsKey, index, field] = key.split('.')
  const stage = STAGE_NAMES[partsKey.slice(0, 2)] ?? ''
  return `${stage} division ${Number(index) + 1} ${field === 'date' ? 'date' : 'lots'}`
}

// A key's place in the form: its field first, then the division, then the box of the division.
function sortPosition(key) {
  if (!key) return [FIELD_ORDER.length + 1, 0, 0]

  const [head, index, field] = key.split('.')
  return [
    FIELD_ORDER.indexOf(head),
    index === undefined ? -1 : Number(index),
    DIVISION_FIELD_ORDER[field] ?? 0,
  ]
}

function compareKeys(left, right) {
  const a = sortPosition(left.key)
  const b = sortPosition(right.key)
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

// Turns what the schema found into form errors: one per field, in the order of the form. The same
// message found twice for one place (a Job with no code and no builder) is shown once.
export function collectFormErrors(issues) {
  const seen = new Set()
  const errors = []

  for (const issue of issues) {
    const key = pathToKey(issue.path)
    const label = describeKey(key)
    const identity = `${label}|${issue.message}`
    if ((key && seen.has(key)) || seen.has(identity)) continue

    if (key) seen.add(key)
    seen.add(identity)
    errors.push({ key, label, message: issue.message })
  }

  // The Phase cannot be chosen before the Job, so while the Job is missing it is not flagged too:
  // one thing to fix at a time.
  const hasJobError = errors.some((error) => error.key === 'jobId')
  return errors
    .filter((error) => !(hasJobError && error.key === 'phaseId'))
    .sort(compareKeys)
}

// What is wrong with the draft right now, or an empty list.
export function validateProductionDraft(draft) {
  const result = calendarEventSchema.safeParse(draft)
  return result.success ? [] : collectFormErrors(result.error.issues)
}

// What a field takes to show its error: the key the form uses to find it again (see
// formErrorFocus.js), and, when it has one, the message under it. `error` makes the field red and
// gives it aria-invalid; the message is tied to the field (aria-describedby) by the TextField.
export function fieldErrorProps(key, message) {
  return {
    'data-error-key': key,
    error: Boolean(message),
    helperText: message || undefined,
  }
}

export function errorsByKey(errors) {
  const byKey = {}
  for (const error of errors) {
    if (error.key && !(error.key in byKey)) byKey[error.key] = error.message
  }
  return byKey
}

// The messages of one division, once each: a range that is wrong shows on both its boxes but is
// said once.
export function divisionMessages(byKey, partsKey, index) {
  const messages = ['lotStart', 'lotEnd', 'date']
    .map((field) => byKey[`${partsKey}.${index}.${field}`])
    .filter(Boolean)
  return [...new Set(messages)]
}

// Whether changing `patch` (the fields of a draft that were just set) touches the field or
// section of `key`.
export function patchTouchesKey(key, patch) {
  if (!key) return false
  return Object.keys(patch).some((field) => key === field || key.startsWith(`${field}.`))
}

const NETWORK_FAILURE = /failed to fetch|networkerror|network request failed|load failed/i

function enabledSplitKey(draft) {
  const enabled = [
    ['dmSplitPhase', 'dmSplitParts'],
    ['hwSplitPhase', 'hwSplitParts'],
  ].filter(([flag]) => draft?.[flag])
  // With both on, the one that fails the check the server makes is the likely one.
  const failing = enabled.find(([, partsKey]) => (
    findSplitCoverageIssue(draft[partsKey] ?? [], draft.lotNumbers ?? [])
  ))
  return (failing ?? enabled[0])?.[1] ?? null
}

// Turns the error of a save that reached the server (the Edge Function, the RPC or the network)
// into a form error. It is tied to a field when the message says which one is the likely cause;
// otherwise `key` is null and the error stays next to Save.
export function classifySaveError(error, { draft = null, isEditing = false } = {}) {
  const message = error?.message || 'The Production calendar request failed.'
  const original = error?.cause?.message ?? ''
  const code = error?.cause?.code ?? ''

  if (NETWORK_FAILURE.test(message) || NETWORK_FAILURE.test(original)) {
    return {
      key: null,
      label: 'Connection',
      message: 'The connection was lost, so nothing was saved. Check it and try again.',
    }
  }

  if (/notes must contain/i.test(original)) {
    return { key: 'notes', label: describeKey('notes'), message: 'Use 500 characters or fewer.' }
  }

  if (/every activity Lot exactly once/i.test(original)) {
    const key = enabledSplitKey(draft)
    if (key) return { key, label: describeKey(key), message }
  }

  // A Phase, Lot or team that is gone: while creating, the Phase is the field to choose again.
  const phaseProblem = code === '23503'
    || /Select between 1 and 500 Lots|selected Lot must be unique/i.test(original)
  if (!isEditing && phaseProblem) {
    return { key: 'phaseId', label: describeKey('phaseId'), message }
  }

  return { key: null, label: 'Save', message }
}

// The line at the top of the list next to Save.
export function failureTitle(errors) {
  if (errors.length === 1) return 'Not saved'
  return `Not saved. ${errors.length} things need fixing.`
}
