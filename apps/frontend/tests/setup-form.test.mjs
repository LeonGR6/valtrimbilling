import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'
import { defaultBillingSettings, defaultDraws } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import { describeFormIssues, setupFromFormValues } from '../src/features/builder-draw-schedules/utils/setupForm.js'
import { describeSetupFigures, diffSetups } from '../src/features/builder-draw-schedules/utils/setupSummary.js'

const blank = () => ({
  builderId: 1,
  draws: defaultDraws.map((draw) => ({ ...draw })),
  ...defaultBillingSettings,
  cutoffDays: [...defaultBillingSettings.cutoffDays],
})
const filled = () => ({
  ...blank(),
  draws: [
    { name: 'Frames', percentage: '25', eventType: 'EXT', lag: null },
    { name: '', percentage: '65', eventType: 'DM', lag: null },
    { name: '', percentage: '10', eventType: 'HW', lag: null },
  ],
})
const issuesOf = (values) => {
  const result = createBuilderDrawScheduleSchema([], null).safeParse(values)
  return result.success ? [] : result.error.issues
}

test('the typed form reads as a setup: numbers are numbers and a fraction is the percentage it stands for', () => {
  const setup = setupFromFormValues({
    ...filled(),
    retentionEnabled: true,
    retentionPercentage: '0.0833',
    ocipWrapEnabled: true,
    ocipWrapPercentage: '2',
    paymentTermsDays: '45',
    cutoffDay: '15',
    optionsBillingDrawIndex: '1',
  })

  assert.deepEqual(setup.draws.map(({ percentage }) => percentage), [25, 65, 10])
  assert.equal(setup.retentionPercentage, 8.33)
  assert.equal(setup.ocipWrapPercentage, 2)
  assert.equal(setup.paymentTermsDays, 45)
  assert.equal(setup.cutoffDay, 15)
  assert.equal(setup.optionsBillingDrawIndex, 1)
  assert.deepEqual(
    describeSetupFigures(setup).map(({ key, value }) => [key, value]),
    [
      ['retention', '8.33% · released per job'],
      ['wrap', '2%'],
      ['payment', 'Net 45 days'],
      ['cutoff', 'Monthly · day 15'],
    ],
  )
})

test('half-typed values do not break the summary', () => {
  const setup = setupFromFormValues({ draws: [{ percentage: '' }, { percentage: 'abc', lag: { value: '', unit: 'WEEKS' } }], cutoffDays: ['', '8'] })

  assert.deepEqual(setup.draws.map(({ percentage, lag }) => [percentage, lag]), [[0, null], [0, null]])
  assert.deepEqual(setup.cutoffDays, [8])
  assert.equal(setup.paymentTermsDays, null)
  assert.deepEqual(setupFromFormValues().draws, [])
})

test('a form that is ready has no issues, and a new one lists what each Draw is missing', () => {
  assert.deepEqual(describeFormIssues(issuesOf(filled()), filled()), [])

  const lines = describeFormIssues(issuesOf(blank()), blank())
  assert.ok(lines.some((line) => line.startsWith('Draw 1: ')))
  assert.ok(lines.some((line) => line.startsWith('Draw 2: ')))
})

test('Draws that do not add up say how much they add up to', () => {
  const values = { ...filled(), draws: [{ name: '', percentage: '40', eventType: 'EXT', lag: null }, { name: '', percentage: '40', eventType: 'DM', lag: null }] }

  assert.deepEqual(describeFormIssues(issuesOf(values), values), ['Draws add up to 80%, not 100%'])
})

test('issues are named by what they are about, and the same one is listed once', () => {
  const values = { ...filled(), retentionEnabled: true, retentionPercentage: 0, frequency: 'SEMIMONTHLY', cutoffDays: [10, 10], submissionMethod: 'EMAIL' }
  const lines = describeFormIssues(issuesOf(values), values)

  assert.ok(lines.includes('Retention: Enter the retention percentage'))
  assert.ok(lines.includes('Cutoff: The two cutoff days must be different'))
  assert.ok(lines.includes('Submission: Enter the submission email'))
  assert.equal(new Set(lines).size, lines.length)

  const noBuilder = { ...filled(), builderId: '' }
  assert.ok(describeFormIssues(issuesOf(noBuilder), noBuilder).includes('Select a builder'))
})

test('the form compares with the setup being edited, field by field', () => {
  const current = setupFromFormValues(filled())
  const same = diffSetups(current, setupFromFormValues(filled()))
  assert.equal(same.changedCount, 0)

  const edited = diffSetups(current, setupFromFormValues({ ...filled(), paymentTermsDays: '45', ocipWrapEnabled: true, ocipWrapPercentage: '1.5' }))
  assert.deepEqual(
    edited.rows.filter(({ changed }) => changed).map(({ label, from, to }) => [label, from, to]),
    [['OCIP / WRAP', 'Off', '1.5%'], ['Payment terms', 'Net 30 days', 'Net 45 days']],
  )
})
