import test from 'node:test'
import assert from 'node:assert/strict'
import {
  classifySaveError,
  collectFormErrors,
  divisionMessages,
  errorsByKey,
  failureTitle,
  fieldErrorProps,
  patchTouchesKey,
  validateProductionDraft,
} from '../src/features/calendar/utils/calendarFormErrors.js'
import { findSplitCoverageIssue } from '../src/features/calendar/utils/splitLotGroups.js'

const validDraft = {
  calendarType: 'PRODUCTION',
  jobId: '1',
  phaseId: '2102',
  jobCode: '1307',
  builder: 'Trumark Homes',
  community: 'Andara',
  phase: 'Phase 2',
  building: 'Building 15',
  lotStart: '66',
  lotEnd: '70',
  lotNumbers: ['66', '67', '68', '69', '70'],
  lotIds: [501, 502, 503, 504, 505],
  foreman: '',
  superintendent: '',
  notes: '',
  extDate: '2026-08-10',
  extDateOwner: 'SUPERVISOR',
  extInstallOnly: false,
  extInstallDate: '',
  dmShutters: false,
  shutterDate: '',
  dmDate: '2026-08-11',
  dmDateOwner: 'TENTATIVE',
  dmInstallOnly: false,
  dmInstallDate: '',
  dmBaseboardInstall: false,
  dmBaseboardInstallDate: '',
  dmSplitPhase: false,
  dmSplitParts: [],
  hwDate: '2026-08-12',
  hwDateOwner: 'TENTATIVE',
  hwSplitPhase: false,
  hwSplitParts: [],
  hwLockUp: false,
  hwLockUpDate: '',
}

const part = (id, lotStart, lotEnd, date = '2026-08-11') => ({
  id,
  lotStart,
  lotEnd,
  date,
  dateOwner: 'TENTATIVE',
})

test('a valid draft has no form errors', () => {
  assert.deepEqual(validateProductionDraft(validDraft), [])
})

test('an invalid date is reported on its own field, named the way the form names it', () => {
  const errors = validateProductionDraft({ ...validDraft, dmDate: '' })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].key, 'dmDate')
  assert.equal(errors[0].label, 'DM date')
  assert.equal(errors[0].message, 'Select a valid date.')
})

test('errors come in the order of the form, whatever order the schema found them in', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    hwDate: '',
    extDate: '',
    dmDate: '',
    hwLockUp: true,
  })

  assert.deepEqual(errors.map((error) => error.key), ['extDate', 'dmDate', 'hwDate', 'hwLockUpDate'])
})

test('a Job that carries no code or builder is one error, shown on the Job', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    jobId: '',
    jobCode: '',
    builder: '',
    community: '',
  })

  assert.deepEqual(errors.map((error) => error.key), ['jobId'])
  assert.equal(errors[0].message, 'Select a job.')
})

test('with no Job chosen the Phase is not flagged too, since it cannot be chosen yet', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    jobId: '',
    jobCode: '',
    phaseId: '',
    phase: '',
    lotNumbers: [],
    lotIds: [],
  })

  assert.deepEqual(errors.map((error) => error.key), ['jobId'])
})

test('what comes from the Phase (lots, range) is reported on the Phase', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    phaseId: '',
    phase: '',
    lotNumbers: [],
    lotIds: [],
  })

  assert.deepEqual(errors.map((error) => error.key), ['phaseId'])
  assert.equal(errors[0].label, 'Phase')
})

test('an install-only date that is missing is reported on that date', () => {
  const errors = validateProductionDraft({ ...validDraft, dmInstallOnly: true })

  assert.deepEqual(errors.map((error) => `${error.key}: ${error.message}`), [
    'dmInstallDate: Select the DM install-only date.',
  ])
})

test('a date owner or note problem is shown under the date it comes with', () => {
  const [error] = collectFormErrors([
    { path: ['dmDateOwner'], message: 'Select a supported date type.' },
  ])
  const [note] = collectFormErrors([
    { path: ['extInstallDateNote'], message: 'Use 100 characters or fewer.' },
  ])

  assert.equal(error.key, 'dmDate')
  assert.equal(note.key, 'extInstallDate')
})

test('a division with a range of no Lot of the Phase is reported on that division', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', 66, 68), part('b', 90, 95)],
  })

  assert.equal(errors.length, 1)
  assert.equal(errors[0].key, 'dmSplitParts.1.lotStart')
  assert.equal(errors[0].label, 'DM division 2 lots')
  assert.match(errors[0].message, /at least one Lot of the phase \(Lots 66–70\)/)
})

test('a division whose From is higher than its To is reported on that division', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    hwSplitPhase: true,
    hwSplitParts: [part('a', 70, 68), part('b', 69, 70)],
  })

  assert.deepEqual(errors.map((error) => [error.key, error.label]), [
    ['hwSplitParts.0.lotStart', 'HW division 1 lots'],
  ])
  assert.match(errors[0].message, /From lot to be lower than or equal to its To lot/)
})

test('Lots left out or repeated belong to the split as a whole', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', 66, 68), part('b', 68, 70)],
  })

  assert.deepEqual(errors.map((error) => error.key), ['dmSplitParts'])
  assert.equal(errors[0].label, 'DM split schedule')
  assert.match(errors[0].message, /Split groups must cover Lots 66–70 once/)
})

test('a split with fewer than two divisions is reported on the split', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', 66, 70)],
  })

  assert.deepEqual(errors.map((error) => error.key), ['dmSplitParts'])
})

test('a division without a date is reported on its date, after its lots', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', 66, 68, ''), part('b', 69, 70, '')],
  })

  assert.deepEqual(errors.map((error) => error.key), [
    'dmSplitParts.0.date',
    'dmSplitParts.1.date',
  ])
  assert.equal(errors[0].label, 'DM division 1 date')
  assert.equal(errors[0].message, 'Enter the date of every division.')
})

test('an empty From or To asks for a number instead of reading as Lot 0', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', '', 68), part('b', 69, '')],
  })

  assert.deepEqual(errors.map((error) => [error.key, error.message]), [
    ['dmSplitParts.0.lotStart', 'Enter a lot number.'],
    ['dmSplitParts.1.lotEnd', 'Enter a lot number.'],
  ])
})

test('a decimal Lot in a division is still a number', () => {
  const errors = validateProductionDraft({
    ...validDraft,
    lotNumbers: ['12', '12.1'],
    lotIds: [1, 2],
    lotStart: '12',
    lotEnd: '12.1',
    dmSplitPhase: true,
    dmSplitParts: [part('a', '12', '12'), part('b', '12.1', '12.1')],
  })

  assert.deepEqual(errors, [])
})

test('the messages of a division are said once each, even when both its boxes fail', () => {
  const byKey = {
    'dmSplitParts.0.lotStart': 'No lot of the phase falls in this range.',
    'dmSplitParts.0.lotEnd': 'No lot of the phase falls in this range.',
    'dmSplitParts.0.date': 'Enter the date of every division.',
  }

  assert.deepEqual(divisionMessages(byKey, 'dmSplitParts', 0), [
    'No lot of the phase falls in this range.',
    'Enter the date of every division.',
  ])
  assert.deepEqual(divisionMessages(byKey, 'dmSplitParts', 1), [])
})

test('errorsByKey keeps the first message of a field and skips the ones with no field', () => {
  assert.deepEqual(
    errorsByKey([
      { key: 'dmDate', message: 'first' },
      { key: 'dmDate', message: 'second' },
      { key: null, message: 'general' },
    ]),
    { dmDate: 'first' },
  )
})

test('findSplitCoverageIssue says which division has the problem', () => {
  const lots = ['1', '2', '3', '4']

  assert.deepEqual(
    findSplitCoverageIssue([part('a', 1, 2), part('b', 9, 9)], lots),
    { problem: 'empty-division', index: 1 },
  )
  assert.deepEqual(
    findSplitCoverageIssue([part('a', 2, 1), part('b', 3, 4)], lots),
    { problem: 'invalid-range', index: 0 },
  )
  assert.deepEqual(
    findSplitCoverageIssue([part('a', 1, 2), part('b', 2, 4)], lots),
    { problem: 'uneven-coverage', index: null },
  )
  assert.equal(findSplitCoverageIssue([part('a', 1, 2), part('b', 3, 4)], lots), null)
})

test('a patch touches the field it sets and the divisions inside a split it sets', () => {
  assert.equal(patchTouchesKey('phaseId', { phaseId: 3, builder: 'x' }), true)
  assert.equal(patchTouchesKey('dmSplitParts.1.date', { dmSplitParts: [] }), true)
  assert.equal(patchTouchesKey('dmSplitParts', { dmSplitParts: [] }), true)
  assert.equal(patchTouchesKey('dmDate', { hwDate: '2026-08-12' }), false)
  assert.equal(patchTouchesKey(null, { hwDate: '2026-08-12' }), false)
})

const serverError = (message, cause) => new Error(message, { cause })

test('a Phase that is no longer available is shown on the Phase while creating', () => {
  const error = serverError(
    'The selected Production activity, Phase, team or Lot is no longer available.',
    { code: '23503', message: 'Select an active Phase' },
  )

  assert.deepEqual(classifySaveError(error, { draft: validDraft }), {
    key: 'phaseId',
    label: 'Phase',
    message: 'The selected Production activity, Phase, team or Lot is no longer available.',
  })
})

test('the same error has no field to point at while editing, where Phase cannot be changed', () => {
  const error = serverError(
    'The selected Production activity, Phase, team or Lot is no longer available.',
    { code: '23503', message: 'Select an active Phase' },
  )

  assert.equal(classifySaveError(error, { draft: validDraft, isEditing: true }).key, null)
})

test('a split the server does not accept is shown on the split that fails', () => {
  const error = serverError('Each required stage must schedule every activity Lot exactly once', {
    code: '23514',
    message: 'Each required stage must schedule every activity Lot exactly once',
  })
  const draft = {
    ...validDraft,
    dmSplitPhase: true,
    dmSplitParts: [part('a', 66, 70), part('b', 66, 70)],
    hwSplitPhase: true,
    hwSplitParts: [part('c', 66, 68), part('d', 69, 70)],
  }

  assert.equal(classifySaveError(error, { draft }).key, 'dmSplitParts')
  assert.equal(
    classifySaveError(error, { draft: { ...draft, dmSplitPhase: false } }).key,
    'hwSplitParts',
  )
  assert.equal(classifySaveError(error, { draft: validDraft }).key, null)
})

test('notes that are too long are shown on the notes', () => {
  const error = serverError('Production notes must contain 500 characters or fewer', {
    code: '23514',
    message: 'Production notes must contain 500 characters or fewer',
  })

  const result = classifySaveError(error, { draft: validDraft })
  assert.equal(result.key, 'notes')
  assert.equal(result.message, 'Use 500 characters or fewer.')
})

test('an error that names no field stays general, with its own message', () => {
  const error = serverError('You do not have permission to change Production calendar activities.', {
    code: '42501',
    message: 'You do not have permission to change Production calendar activities',
  })

  assert.deepEqual(classifySaveError(error, { draft: validDraft }), {
    key: null,
    label: 'Save',
    message: 'You do not have permission to change Production calendar activities.',
  })
})

test('a lost connection says nothing was saved and what to do', () => {
  const result = classifySaveError(new Error('TypeError: Failed to fetch'), { draft: validDraft })

  assert.equal(result.key, null)
  assert.equal(
    result.message,
    'The connection was lost, so nothing was saved. Check it and try again.',
  )
})

test('the title counts the things to fix', () => {
  assert.equal(failureTitle([{ key: 'dmDate' }]), 'Not saved')
  assert.equal(failureTitle([{ key: 'dmDate' }, { key: 'hwDate' }]), 'Not saved. 2 things need fixing.')
})

test('a field takes its error key always, and its message only when it has one', () => {
  assert.deepEqual(fieldErrorProps('dmDate', 'Select a valid date.'), {
    'data-error-key': 'dmDate',
    error: true,
    helperText: 'Select a valid date.',
  })
  assert.deepEqual(fieldErrorProps('dmDate', undefined), {
    'data-error-key': 'dmDate',
    error: false,
    helperText: undefined,
  })
})
