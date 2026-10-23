import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeCutoff,
  describeSetupDetails,
  describeSetupDraws,
  describeSetupFigures,
  describeSetupHeadline,
  diffSetups,
  formatSetupPercentage,
} from '../src/features/builder-draw-schedules/utils/setupSummary.js'
import { canCreateWithSetup, resolveJobSetup } from '../src/features/jobs/utils/jobSetup.js'

const setup = (overrides = {}) => ({
  id: 16,
  builderId: 5,
  versionNumber: 2,
  status: 'ACTIVE',
  draws: [
    { name: 'Frames delivered', percentage: 25, eventType: 'EXT', lag: null },
    { name: '', percentage: 65, eventType: 'DM', lag: null },
    { name: '', percentage: 10, eventType: 'HW', lag: { value: 2, unit: 'WEEKS' } },
  ],
  separateHardwarePrice: true,
  hardwareBillingMode: 'BY_EVENT',
  hardwareEventPercentages: { EXT: 0, DM: 0, HW: 100 },
  utilityBuilding: false,
  utilityBillingMode: 'FULL',
  utilityEventPercentages: { EXT: 0, DM: 0, HW: 0 },
  optionsBillingDrawIndex: 1,
  frequency: 'SEMIMONTHLY',
  anyDate: false,
  cutoffDay: null,
  cutoffDays: [22, 8],
  cutoffWeekday: 0,
  paymentTermsDays: 30,
  retentionEnabled: true,
  retentionPercentage: 5,
  retentionReleaseScope: 'BUILDING',
  ocipWrapEnabled: true,
  ocipWrapPercentage: 2,
  requiresPo: true,
  requiresPaymentSchedule: true,
  requiresRelease: true,
  finalReleaseScope: 'PHASE',
  requiresBackup: false,
  invoiceLineFormat: 'LOT_SCOPE',
  submissionMethod: 'PORTAL',
  submissionDestination: 'Tri Pointe portal',
  notes: '',
  ...overrides,
})

test('percentages drop trailing zeros', () => {
  assert.equal(formatSetupPercentage(2), '2')
  assert.equal(formatSetupPercentage(1.5), '1.5')
  assert.equal(formatSetupPercentage('0.125'), '0.125')
  assert.equal(formatSetupPercentage('x'), '0')
})

test('the cutoff reads the way the Builder bills', () => {
  assert.equal(describeCutoff(setup({ anyDate: true, frequency: 'MONTHLY' })), 'Any date')
  assert.equal(describeCutoff(setup({ frequency: 'MONTHLY', cutoffDay: 10 })), 'Monthly · day 10')
  assert.equal(describeCutoff(setup()), 'Twice a month · days 8 and 22')
  assert.equal(describeCutoff(setup({ frequency: 'WEEKLY', cutoffWeekday: 1 })), 'Weekly · Monday')
})

test('the figures that change a Package come first, retention and wrap marked when on', () => {
  const figures = describeSetupFigures(setup())

  assert.deepEqual(figures.map(({ key }) => key), ['retention', 'wrap', 'payment', 'cutoff'])
  assert.equal(figures[0].value, '5% · released per building')
  assert.equal(figures[1].value, '2%')
  assert.equal(figures[2].value, 'Net 30 days')

  const off = describeSetupFigures(setup({ retentionEnabled: false, ocipWrapEnabled: false }))
  assert.deepEqual(off.slice(0, 2).map(({ value, on }) => [value, on]), [['Off', false], ['Off', false]])
  assert.equal(describeSetupHeadline(setup()), 'Retention 5% · OCIP / WRAP 2% · Payment terms Net 30 days')
})

test('the Draws list what each bills, when, and which one bills the options', () => {
  const { draws, total, totalIsComplete } = describeSetupDraws(setup())

  assert.deepEqual(draws.map(({ number, percentage, eventType }) => [number, percentage, eventType]), [
    [1, '25', 'EXT'], [2, '65', 'DM'], [3, '10', 'HW'],
  ])
  assert.equal(draws[0].name, 'Frames delivered')
  assert.equal(draws[2].lag, '2 weeks')
  assert.deepEqual(draws.map(({ billsOptions }) => billsOptions), [false, true, false])
  assert.equal(total, '100')
  assert.equal(totalIsComplete, true)
  assert.equal(describeSetupDraws(setup({ draws: [{ percentage: 40, eventType: 'EXT' }] })).totalIsComplete, false)
})

test('the rest of the setup is described in plain words', () => {
  const details = Object.fromEntries(describeSetupDetails(setup()).map(({ label, value }) => [label, value]))

  assert.equal(details.Hardware, 'Separate price · HW 100%')
  assert.equal(details['Utility building'], 'Off')
  assert.equal(details['Options are billed in'], 'Draw 2')
  assert.equal(details['Invoice lines'], 'One line per lot and scope')
  assert.equal(details['Submitted by'], 'Portal · Tri Pointe portal')
  assert.equal(details['Required documents'], 'Purchase order · Payment schedule · Release (final per phase)')
  assert.equal('Notes' in details, false)

  const other = Object.fromEntries(describeSetupDetails(setup({
    separateHardwarePrice: false,
    utilityBuilding: true,
    utilityBillingMode: 'BY_EVENT',
    utilityEventPercentages: { EXT: 50, DM: 50, HW: 0 },
    optionsBillingDrawIndex: null,
    requiresPo: false,
    requiresPaymentSchedule: false,
    requiresRelease: false,
    submissionDestination: '',
    notes: ' Net of deposits ',
  })).map(({ label, value }) => [label, value]))
  assert.equal(other.Hardware, 'Included in the Plan price')
  assert.equal(other['Utility building'], 'On · split by event · EXT 50% · DM 50%')
  assert.equal(other['Options are billed in'], 'Not set')
  assert.equal(other['Required documents'], 'None required')
  assert.equal(other['Submitted by'], 'Portal')
  assert.equal(other.Notes, 'Net of deposits')
})

test('a new Job shows the Builder current setup; an existing one keeps its own version', () => {
  const current = setup({ id: 20, versionNumber: 3 })
  const own = setup({ id: 16, versionNumber: 2, status: 'SUPERSEDED' })
  const job = { builderId: 5, billingSetupVersionId: 16 }

  const created = resolveJobSetup({ job: null, builderId: 5, builderSetups: [current], jobSetups: [] })
  assert.deepEqual([created.setup.id, created.source, created.newerBuilderSetup], [20, 'builder', null])

  const existing = resolveJobSetup({ job, builderId: 5, builderSetups: [current], jobSetups: [own] })
  assert.deepEqual([existing.setup.id, existing.source, existing.newerBuilderSetup.id], [16, 'job', 20])

  // Up to date: nothing newer to mention.
  assert.equal(resolveJobSetup({ job, builderId: 5, builderSetups: [own], jobSetups: [own] }).newerBuilderSetup, null)

  // Moving the Job to another Builder gives it that Builder's setup.
  const moved = resolveJobSetup({ job, builderId: 6, builderSetups: [current, setup({ id: 30, builderId: 6 })], jobSetups: [own] })
  assert.deepEqual([moved.setup.id, moved.source], [30, 'builder'])

  // Nothing active, or the Job's version not loaded.
  assert.equal(resolveJobSetup({ job: null, builderId: 9, builderSetups: [current] }).source, 'none')
  assert.equal(resolveJobSetup({ job, builderId: 5, builderSetups: [current], jobSetups: [] }).source, 'none')
})

test('a new Job can be created only after confirming the version that is shown', () => {
  const shown = setup({ id: 20 })

  assert.equal(canCreateWithSetup(shown, 20), true)
  assert.equal(canCreateWithSetup(shown, '20'), true)
  assert.equal(canCreateWithSetup(shown, null), false)
  // The setup changed after it was confirmed: it has to be confirmed again.
  assert.equal(canCreateWithSetup(setup({ id: 21 }), 20), false)
  assert.equal(canCreateWithSetup(null, 20), false)
})

test('two versions side by side say what differs, wrap and retention first', () => {
  const now = setup({ versionNumber: 2, ocipWrapPercentage: 1 })
  const next = setup({ id: 20, versionNumber: 3, ocipWrapPercentage: 2 })
  const { rows, changedCount } = diffSetups(now, next)

  assert.equal(changedCount, 1)
  const changed = rows.filter(({ changed: isChanged }) => isChanged)
  assert.deepEqual(changed.map(({ label, from, to }) => [label, from, to]), [['OCIP / WRAP', '1%', '2%']])
  assert.deepEqual(rows.slice(0, 4).map(({ label }) => label), ['Retention', 'OCIP / WRAP', 'Payment terms', 'Cutoff'])
  assert.equal(rows.some(({ group }) => group === 'Draws'), true)
  assert.equal(diffSetups(now, now).changedCount, 0)
})

test('a version with another number of Draws shows the missing ones as dashes', () => {
  const longer = setup({
    draws: [...setup().draws, { name: '', percentage: 0, eventType: 'HW', lag: null }],
  })
  const { rows } = diffSetups(setup(), longer)
  const fourth = rows.find(({ label }) => label === 'Draw 4')

  assert.deepEqual([fourth.from, fourth.changed], ['—', true])
  assert.match(fourth.to, /^0% · HW/)
  const different = diffSetups(setup(), setup({ draws: [{ name: '', percentage: 100, eventType: 'EXT', lag: null }] }))
  assert.equal(different.rows.find(({ label }) => label === 'Draw 1').to, '100% · EXT')
  assert.equal(different.rows.find(({ label }) => label === 'Draw 3').to, '—')
})

test('details that only one version has are compared with a dash', () => {
  const added = diffSetups(setup(), setup({ notes: 'Net of deposits' }))
  const addedNote = added.rows.find(({ label }) => label === 'Notes')
  assert.equal(addedNote.changed, true)
  assert.equal(addedNote.from, '—')
  assert.equal(addedNote.to, 'Net of deposits')

  const lost = diffSetups(setup({ notes: 'Net of deposits' }), setup())
  assert.deepEqual(lost.rows.find(({ label }) => label === 'Notes').to, '—')
})
