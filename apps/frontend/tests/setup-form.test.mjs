import assert from 'node:assert/strict'
import test from 'node:test'
import { createBuilderDrawScheduleSchema } from '../src/features/builder-draw-schedules/schemas/builderDrawScheduleSchema.js'
import { defaultBillingSettings, defaultDraws } from '../src/features/builder-draw-schedules/data/builderDrawSchedules.js'
import {
  SETUP_SECTIONS,
  countIssuesBySection,
  describeFormIssueTargets,
  describeFormIssues,
  explainSaveError,
  locateFormIssue,
  setupFromFormValues,
} from '../src/features/builder-draw-schedules/utils/setupForm.js'
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

test('a named submission method carries no destination, and Portal keeps its name', () => {
  const read = (submissionMethod, submissionDestination) => setupFromFormValues({
    ...filled(),
    submissionMethod,
    submissionDestination,
  })

  for (const method of ['SUPPLY_PRO', 'TEXTURA', 'KB_IE', 'KB_LA']) {
    assert.equal(read(method, ' leftover from Portal ').submissionDestination, '', method)
  }
  assert.equal(read('PORTAL', ' Own portal ').submissionDestination, 'Own portal')
  assert.equal(read('EMAIL', ' ap@builder.com ').submissionDestination, 'ap@builder.com')
})

test('a named submission method asks for nothing more in the form', () => {
  const lines = describeFormIssues(issuesOf({ ...filled(), submissionMethod: 'TEXTURA', submissionDestination: '' }))

  assert.equal(lines.some((line) => line.startsWith('Submission:')), false)
})

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

test('an issue says which part of the form it is in and which field to take the person to', () => {
  assert.deepEqual(locateFormIssue(['builderId']), { section: 'builder', name: 'builderId' })
  assert.deepEqual(locateFormIssue(['draws', 2, 'percentage']), { section: 'draws', name: 'draws.2.percentage' })
  assert.deepEqual(locateFormIssue(['draws', 1, 'eventType']), { section: 'draws', name: 'draws.1.eventType' })
  assert.deepEqual(locateFormIssue(['draws', 0, 'lag']), { section: 'draws', name: 'draws.0.lag' })
  // The total of the Draws belongs to no single Draw: it leads to the first percentage.
  assert.deepEqual(locateFormIssue(['draws']), { section: 'draws', name: 'draws.0.percentage' })
  assert.deepEqual(locateFormIssue(['optionsBillingDrawIndex']), { section: 'draws', name: 'optionsBillingDrawIndex' })
  assert.deepEqual(locateFormIssue(['hardwareEventPercentages']), { section: 'hardware', name: 'hardwareEventPercentages.EXT' })
  assert.deepEqual(locateFormIssue(['utilityEventPercentages', 'DM']), { section: 'hardware', name: 'utilityEventPercentages.DM' })
  assert.deepEqual(locateFormIssue(['cutoffDays']), { section: 'cycle', name: 'cutoffDays.0' })
  assert.deepEqual(locateFormIssue(['cutoffDay']), { section: 'cycle', name: 'cutoffDay' })
  assert.deepEqual(locateFormIssue(['paymentTermsDays']), { section: 'cycle', name: 'paymentTermsDays' })
  assert.deepEqual(locateFormIssue(['retentionPercentage']), { section: 'deductions', name: 'retentionPercentage' })
  assert.deepEqual(locateFormIssue(['ocipWrapPercentage']), { section: 'deductions', name: 'ocipWrapPercentage' })
  assert.deepEqual(locateFormIssue(['finalReleaseScope']), { section: 'submission', name: 'finalReleaseScope' })
  assert.deepEqual(locateFormIssue(['submissionDestination']), { section: 'submission', name: 'submissionDestination' })
  assert.deepEqual(locateFormIssue([]), { section: 'submission', name: undefined })
  assert.deepEqual(Object.keys(SETUP_SECTIONS), ['builder', 'draws', 'hardware', 'cycle', 'deductions', 'submission'])
})

test('every line the form lists can be found on the form, with its part counted', () => {
  const values = {
    ...filled(),
    requiresRelease: true,
    finalReleaseScope: '',
    retentionEnabled: true,
    retentionPercentage: 0,
    frequency: 'SEMIMONTHLY',
    cutoffDays: [10, 10],
    submissionMethod: 'EMAIL',
    submissionDestination: '',
  }
  const targets = describeFormIssueTargets(issuesOf(values), values)
  const byText = Object.fromEntries(targets.map(({ text, name, section }) => [text, { name, section }]))

  assert.deepEqual(byText['Release: Select where the Conditional Final Release applies'], { name: 'finalReleaseScope', section: 'submission' })
  assert.deepEqual(byText['Retention: Enter the retention percentage'], { name: 'retentionPercentage', section: 'deductions' })
  assert.deepEqual(byText['Cutoff: The two cutoff days must be different'], { name: 'cutoffDays.0', section: 'cycle' })
  assert.deepEqual(byText['Submission: Enter the submission email'], { name: 'submissionDestination', section: 'submission' })
  assert.deepEqual(countIssuesBySection(targets), { submission: 2, deductions: 1, cycle: 1 })
  // The plain lines are the same ones.
  assert.deepEqual(describeFormIssues(issuesOf(values), values), targets.map(({ text }) => text))
  assert.deepEqual(countIssuesBySection([]), {})
})

test('a refused save names the field it is about, in the words of the form', () => {
  assert.deepEqual(explainSaveError('Hardware event percentages must total 100'), {
    text: 'Hardware event percentages must total exactly 100%.',
    name: 'hardwareEventPercentages.EXT',
    section: 'hardware',
  })
  // The database sometimes answers in Spanish.
  assert.deepEqual(explainSaveError('Los porcentajes de los draws deben sumar 100'), {
    text: 'Draw percentages must total exactly 100%.',
    name: 'draws.0.percentage',
    section: 'draws',
  })
  assert.equal(explainSaveError('La configuracion debe tener entre 2 y 5 draws').section, 'draws')
  assert.equal(explainSaveError('El draw configurado para options no existe').name, 'optionsBillingDrawIndex')
  assert.equal(explainSaveError('Select Per Phase, Per Building or Per Project for the Conditional Final Release').name, 'finalReleaseScope')
  assert.equal(
    explainSaveError('The Conditional Final Release scope needs Release to be required to submit').text,
    'The Conditional Final Release needs a Release to be required.',
  )
  assert.equal(explainSaveError('Every Utility allocation needs a matching Draw event').text, 'Every Utility allocation needs a Draw with that event.')
  assert.equal(explainSaveError('Utility event percentages must total 100').text, 'Utility event percentages must total exactly 100%.')
  assert.equal(explainSaveError('This Builder already has an active billing setup.').name, 'builderId')

  // Something no field holds is said as it is, with nowhere to point.
  assert.deepEqual(explainSaveError('You do not have permission to change Builder billing setups.'), {
    text: 'You do not have permission to change Builder billing setups.',
    name: null,
    section: null,
  })
  assert.deepEqual(explainSaveError(''), { text: '', name: null, section: null })
})
