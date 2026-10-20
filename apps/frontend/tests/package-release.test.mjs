import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExceptionFillValues,
  buildExceptionRows,
  buildFinalReleaseNote,
  buildPackageDocumentStoragePath,
  buildPackageFillValues,
  buildPackageReleaseFileName,
  describeFillPlan,
  chooseRelease,
  isFromPastCutoff,
  newManualExceptionRow,
  CONDITIONAL_FINAL_TYPE,
  CONDITIONAL_PROGRESS_TYPE,
  describePendingPackage,
  sha256Hex,
  sumAmounts,
  toPackageReleaseValues,
} from '../src/features/release-templates/services/packageRelease.js'
import { formatReleaseValue, formatReleaseValues } from '../src/features/release-templates/services/releaseValueFormat.js'

// The row the values RPC returns for a real development Package.
const row = {
  package_id: 46,
  job_id: 22,
  package_number: 'DP-00000046',
  package_date: '2026-10-05',
  cutoff_date: '2026-10-10',
  cutoff_source: 'builder_setup',
  invoice_number: null,
  gross_amount: 1825.0,
  retention_amount: 91.25,
  wrap_amount: 36.5,
  net_amount: 1697.25,
  package_type: 'DRAW',
  final_release: {
    applicable: true,
    reason: null,
    scope: 'PHASE',
    is_final: false,
    scopes: [
      { key: '1', label: 'Phase 1', total: 12, covered_before: 6, covered_after: 8, remaining_after: 4, closes: false },
    ],
  },
  pending_packages: [
    {
      package_id: 8,
      package_number: 'DP-00000008',
      package_date: '2026-09-11',
      cutoff_date: '2026-09-20',
      cutoff_source: 'builder_setup',
      net_amount: 1200,
      status: 'SUBMITTED',
      workflow_status: 'AWAITING_PAYMENT',
    },
    {
      package_id: 15,
      package_number: 'DP-00000015',
      package_date: '2026-09-18',
      cutoff_date: '2026-10-05',
      cutoff_source: 'package_date',
      net_amount: '845.5',
      status: 'DRAFT',
      workflow_status: 'AWAITING_PAYMENT',
    },
  ],
}

test('the values row maps to the model the screen uses', () => {
  assert.deepEqual(toPackageReleaseValues(row), {
    packageId: 46,
    jobId: 22,
    packageNumber: 'DP-00000046',
    packageType: 'DRAW',
    packageDate: '2026-10-05',
    cutoffDate: '2026-10-10',
    cutoffSource: 'builder_setup',
    invoiceNumber: null,
    grossAmount: 1825,
    retentionAmount: 91.25,
    wrapAmount: 36.5,
    netAmount: 1697.25,
    pendingPackages: [
      {
        id: 8,
        number: 'DP-00000008',
        packageDate: '2026-09-11',
        cutoffDate: '2026-09-20',
        cutoffSource: 'builder_setup',
        netAmount: 1200,
        status: 'SUBMITTED',
        workflowStatus: 'AWAITING_PAYMENT',
      },
      {
        id: 15,
        number: 'DP-00000015',
        packageDate: '2026-09-18',
        cutoffDate: '2026-10-05',
        cutoffSource: 'package_date',
        netAmount: 845.5,
        status: 'DRAFT',
        workflowStatus: 'AWAITING_PAYMENT',
      },
    ],
    sameCutoffPackages: [],
    finalRelease: {
      applicable: true,
      reason: null,
      scope: 'PHASE',
      isFinal: false,
      scopes: [
        { key: '1', label: 'Phase 1', total: 12, remainingAfter: 4, closes: false },
      ],
    },
  })
})

const pendingRow = (id, cutoff, net = 100) => ({
  package_id: id,
  package_number: `DP-${id}`,
  package_date: cutoff,
  cutoff_date: cutoff,
  cutoff_source: 'builder_setup',
  net_amount: net,
  status: 'SUBMITTED',
  workflow_status: 'AWAITING_PAYMENT',
})

test('an unpaid Package with the same cut-off date is not counted, only past cut-offs are', () => {
  const values = toPackageReleaseValues({
    ...row, // cut-off 2026-10-10
    pending_packages: [
      pendingRow(1, '2026-09-25', 300),
      pendingRow(2, '2026-10-10', 400), // same cut-off: billed together with this one
      pendingRow(3, '2026-10-09', 500), // the day before: a past cut-off
      pendingRow(4, '2026-10-10', 600),
    ],
  })

  assert.deepEqual(values.pendingPackages.map(({ id }) => id), [1, 3])
  assert.deepEqual(values.sameCutoffPackages.map(({ id }) => id), [2, 4])

  // They do not reach the Exceptions lines either.
  const fill = buildPackageFillValues(values)
  assert.deepEqual(fill.waiver_release_dates, ['2026-09-25', '2026-10-09'])
  assert.deepEqual(fill.unpaid_progress_amount, [300, 500])
})

test('when every unpaid Package shares the cut-off date both lines stay empty', () => {
  const values = toPackageReleaseValues({
    ...row,
    pending_packages: [pendingRow(2, '2026-10-10'), pendingRow(4, '2026-10-10')],
  })
  assert.deepEqual(values.pendingPackages, [])
  assert.equal(values.sameCutoffPackages.length, 2)

  const fill = buildPackageFillValues(values)
  assert.deepEqual([fill.waiver_release_dates, fill.unpaid_progress_amount], [[], []])
})

test('the cut-off rule compares dates, so a Package date earlier in the same cut-off is still left out', () => {
  assert.equal(isFromPastCutoff('2026-09-30', '2026-10-10'), true)
  assert.equal(isFromPastCutoff('2026-10-10', '2026-10-10'), false)
  assert.equal(isFromPastCutoff('2026-10-11', '2026-10-10'), false)
  // A date that is missing cannot be told apart, so the Package is kept.
  assert.equal(isFromPastCutoff(null, '2026-10-10'), true)
  assert.equal(isFromPastCutoff('2026-09-30', null), true)

  // Packages of two different days that fall in the same cut-off share its date.
  const values = toPackageReleaseValues({
    ...row,
    pending_packages: [{ ...pendingRow(5, '2026-10-10'), package_date: '2026-10-01' }],
  })
  assert.deepEqual(values.pendingPackages, [])
})

test('a Package row without a pending list (an older answer) has none', () => {
  const { pending_packages: _omitted, ...withoutList } = row
  assert.deepEqual(toPackageReleaseValues(withoutList).pendingPackages, [])
})

test('amounts that come as text or are missing are handled', () => {
  const values = toPackageReleaseValues({ ...row, net_amount: '1697.25', wrap_amount: null, retention_amount: '' })
  assert.equal(values.netAmount, 1697.25)
  assert.equal(values.wrapAmount, null)
  assert.equal(values.retentionAmount, null)
})

test('the net amount is the gross minus retention and wrap', () => {
  const { grossAmount, retentionAmount, wrapAmount, netAmount } = toPackageReleaseValues(row)
  assert.equal(Math.round((grossAmount - retentionAmount - wrapAmount) * 100) / 100, netAmount)
})

test('Through Date and Date of Signature are the cut-off and Amount of Check is the net amount', () => {
  const fill = buildPackageFillValues(toPackageReleaseValues(row))
  assert.deepEqual(fill, {
    through_date: '2026-10-10',
    check_amount: 1697.25,
    signature_date: '2026-10-10',
    waiver_release_dates: ['2026-09-20', '2026-10-05'],
    unpaid_progress_amount: [1200, 845.5],
    disputed_claims_amount: 2045.5,
  })

  // What ends up printed on the form.
  assert.equal(formatReleaseValue('through_date', 'MM/DD/YYYY', fill.through_date), '10/10/2026')
  assert.equal(formatReleaseValue('signature_date', 'MMMM D, YYYY', fill.signature_date), 'October 10, 2026')
  assert.equal(formatReleaseValue('check_amount', 'plain', fill.check_amount), '1,697.25')
})

test('a Package without an amount leaves the check amount empty', () => {
  const fill = buildPackageFillValues(toPackageReleaseValues({ ...row, net_amount: null }))
  assert.equal(fill.check_amount, '')
  assert.equal(formatReleaseValue('check_amount', 'plain', fill.check_amount), '')
})

test('the fill plan separates what a Package fills from what stays blank', () => {
  const field = (variable) => ({ variable, target: { kind: 'rect', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, fontSize: 10, format: 'plain' })
  const plan = describeFillPlan({
    version: 1,
    fields: [
      field('through_date'),
      field('check_amount'),
      field('signature_date'),
      field('waiver_release_dates'),
      field('unpaid_progress_amount'),
    ],
  })

  assert.deepEqual(plan.filled.map(({ key }) => key), [
    'through_date',
    'check_amount',
    'signature_date',
    'waiver_release_dates',
    'unpaid_progress_amount',
  ])
  assert.deepEqual(plan.blank, [])
  assert.deepEqual(plan.missingFromForm, [])
})

test('a form without the Exceptions lines is normal and is not reported as missing them', () => {
  const field = (variable) => ({ variable, target: { kind: 'rect', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, fontSize: 10, format: 'plain' })
  const plan = describeFillPlan({
    version: 1,
    fields: [field('through_date'), field('check_amount'), field('signature_date')],
  })
  assert.deepEqual(plan.missingFromForm, [])
  assert.deepEqual(plan.filled.map(({ key }) => key), ['through_date', 'check_amount', 'signature_date'])
})

test('a form without a Through Date or an amount says so', () => {
  const plan = describeFillPlan({
    version: 1,
    fields: [{ variable: 'signature_date', target: { kind: 'rect', page: 1, x: 0.1, y: 0.8, w: 0.2, h: 0.02 }, fontSize: 10, format: 'MM/DD/YYYY' }],
  })
  assert.deepEqual(plan.filled.map(({ key }) => key), ['signature_date'])
  assert.deepEqual(plan.missingFromForm.map(({ label }) => label), ['Through Date', 'Amount of Check'])
  assert.deepEqual(describeFillPlan(null).filled, [])
})

const progressTemplate = { id: 'p', releaseType: CONDITIONAL_PROGRESS_TYPE }
const finalTemplate = { id: 'f', releaseType: CONDITIONAL_FINAL_TYPE }

function valuesWith(finalRelease, packageType = 'DRAW') {
  return toPackageReleaseValues({ ...row, package_type: packageType, final_release: finalRelease })
}

const lastOfPhase = {
  applicable: true,
  reason: null,
  scope: 'PHASE',
  is_final: true,
  scopes: [
    { key: '5', label: 'Phase 5', total: 9, covered_before: 0, covered_after: 9, remaining_after: 0, closes: true },
  ],
}

test('the Release values keep the package type and the final-release answer', () => {
  const values = toPackageReleaseValues(row)
  assert.equal(values.packageType, 'DRAW')
  assert.equal(values.finalRelease.applicable, true)
  assert.equal(values.finalRelease.isFinal, false)
  assert.equal(values.finalRelease.scopes[0].remainingAfter, 4)

  // A function that predates the option answers nothing.
  const old = toPackageReleaseValues({ ...row, package_type: undefined, final_release: undefined })
  assert.equal(old.packageType, 'DRAW')
  assert.equal(old.finalRelease.applicable, false)
  assert.deepEqual(old.finalRelease.scopes, [])
})

test('a Package that is not the last one uses the Conditional Progress Release', () => {
  const choice = chooseRelease(toPackageReleaseValues(row), [progressTemplate, finalTemplate])
  assert.equal(choice.state, 'ready')
  assert.equal(choice.releaseType, CONDITIONAL_PROGRESS_TYPE)
  assert.equal(choice.template, progressTemplate)
  assert.equal(choice.isFinal, false)
})

test('the last Package of its scope uses the Conditional Final Release', () => {
  const choice = chooseRelease(valuesWith(lastOfPhase), [progressTemplate, finalTemplate])
  assert.equal(choice.state, 'ready')
  assert.equal(choice.releaseType, CONDITIONAL_FINAL_TYPE)
  assert.equal(choice.template, finalTemplate)
  assert.deepEqual(choice.closing, ['Phase 5'])
})

test('the last Package is not generated with the Progress form when the Final one is missing', () => {
  const choice = chooseRelease(valuesWith(lastOfPhase), [progressTemplate])
  assert.equal(choice.state, 'missing_template')
  assert.equal(choice.isFinal, true)
  assert.equal(choice.template, null)
  assert.deepEqual(choice.closing, ['Phase 5'])
})

test('a Package without a Progress template cannot be generated either', () => {
  const choice = chooseRelease(toPackageReleaseValues(row), [finalTemplate])
  assert.equal(choice.state, 'missing_template')
  assert.equal(choice.isFinal, false)
  assert.equal(choice.releaseType, CONDITIONAL_PROGRESS_TYPE)
})

test('a setup without a Final scope keeps using the Progress form', () => {
  const choice = chooseRelease(
    valuesWith({ applicable: false, reason: 'NOT_CONFIGURED', scope: null, is_final: false, scopes: [] }),
    [progressTemplate, finalTemplate],
  )
  assert.equal(choice.state, 'ready')
  assert.equal(choice.isFinal, false)
  assert.equal(choice.scopeConfigured, false)
})

test('a Retention Release Package is not generated', () => {
  const choice = chooseRelease(
    valuesWith(
      { applicable: false, reason: 'RETENTION_RELEASE', scope: null, is_final: false, scopes: [] },
      'RETENTION_RELEASE',
    ),
    [progressTemplate, finalTemplate],
  )
  assert.equal(choice.state, 'retention')
  assert.equal(choice.template, null)
})

test('the Final form is filled with the Package net amount and cut-off date', () => {
  const fill = buildPackageFillValues(valuesWith(lastOfPhase), [])
  assert.equal(fill.check_amount, 1697.25)
  assert.equal(fill.signature_date, '2026-10-10')
  assert.deepEqual(fill.waiver_release_dates, [])
})

test('the generated file has a readable name that is safe to save', () => {
  assert.equal(
    buildPackageReleaseFileName({
      jobCode: '1307',
      packageNumber: 'DP-00000046',
      releaseType: 'ConditionalWaiverAndReleaseOnProgressPayment',
    }),
    'Release - Job 1307 - DP-00000046 - Conditional Progress.pdf',
  )
  assert.equal(
    buildPackageReleaseFileName({ jobCode: 'A/B:1', packageNumber: 'DP\\1*', releaseType: 'UnconditionalWaiverAndReleaseOnFinalPayment' }),
    'Release - Job A B 1 - DP 1 - Unconditional Final.pdf',
  )
  assert.equal(buildPackageReleaseFileName({ releaseType: 'unknown' }), 'Release.pdf')

  const long = buildPackageReleaseFileName({ jobCode: 'x'.repeat(400), packageNumber: 'DP-1', releaseType: 'ConditionalWaiverAndReleaseOnFinalPayment' })
  assert.ok(long.length <= 255)
  assert.ok(long.endsWith('.pdf'))
})

test('the Storage path follows the Package and the release folder the database expects', () => {
  const path = buildPackageDocumentStoragePath(46, '6f1f6d4e-7d4b-4a37-9f4e-2b8f4f3c9a10')
  assert.equal(path, '46/release/6f1f6d4e-7d4b-4a37-9f4e-2b8f4f3c9a10.pdf')
  assert.match(path, /^46\/release\/[0-9a-f-]{36}\.pdf$/)
})

test('the checksum is a lowercase 64 character SHA-256, as the database requires', async () => {
  const hash = await sha256Hex(new TextEncoder().encode('abc'))
  assert.equal(hash, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.match(hash, /^[0-9a-f]{64}$/)
})

// --- Unpaid earlier Packages -------------------------------------------------

test('the Exceptions lines list the cut-off date and net amount of each unpaid earlier Package', () => {
  const values = toPackageReleaseValues(row)
  const fill = buildPackageFillValues(values)

  assert.deepEqual(fill.waiver_release_dates, ['2026-09-20', '2026-10-05'])
  assert.deepEqual(fill.unpaid_progress_amount, [1200, 845.5])

  // What is printed: one date and one amount per pending Package, in order.
  assert.equal(formatReleaseValues('waiver_release_dates', 'MM/DD/YYYY', fill.waiver_release_dates), '09/20/2026, 10/05/2026')
  assert.equal(formatReleaseValues('unpaid_progress_amount', 'plain', fill.unpaid_progress_amount), '1,200.00, 845.50')
  assert.equal(formatReleaseValues('unpaid_progress_amount', 'currency', fill.unpaid_progress_amount), '$1,200.00, $845.50')
})

test('with no unpaid earlier Package both lines stay empty', () => {
  const fill = buildPackageFillValues(toPackageReleaseValues({ ...row, pending_packages: [] }))
  assert.deepEqual(fill.waiver_release_dates, [])
  assert.deepEqual(fill.unpaid_progress_amount, [])
  assert.equal(formatReleaseValues('waiver_release_dates', 'MM/DD/YYYY', fill.waiver_release_dates), '')
  assert.equal(formatReleaseValues('unpaid_progress_amount', 'plain', fill.unpaid_progress_amount), '')
})

test('a Package can be left out of the lists', () => {
  const values = toPackageReleaseValues(row)
  const fill = buildPackageFillValues(values, values.pendingPackages.filter(({ id }) => id !== 8))
  assert.deepEqual(fill.waiver_release_dates, ['2026-10-05'])
  assert.deepEqual(fill.unpaid_progress_amount, [845.5])
  // The Package's own values do not change.
  assert.equal(fill.through_date, '2026-10-10')
  assert.equal(fill.check_amount, 1697.25)
})

test('a pending Package without an invoice amount adds its date but no amount', () => {
  const values = toPackageReleaseValues({
    ...row,
    pending_packages: [{ ...row.pending_packages[0], net_amount: null }, row.pending_packages[1]],
  })
  const fill = buildPackageFillValues(values)
  assert.deepEqual(fill.waiver_release_dates, ['2026-09-20', '2026-10-05'])
  assert.deepEqual(fill.unpaid_progress_amount, [845.5])
})

test('a list prints only the items that can be printed', () => {
  assert.equal(formatReleaseValues('waiver_release_dates', 'MM/DD/YYYY', ['2026-09-20', 'nope', '2026-10-05']), '09/20/2026, 10/05/2026')
  assert.equal(formatReleaseValues('through_date', 'MM/DD/YYYY', '2026-09-20'), '09/20/2026')
  assert.equal(formatReleaseValues('unpaid_progress_amount', 'plain', []), '')
  assert.equal(formatReleaseValues('unpaid_progress_amount', 'plain', undefined), '')
})

test('the list shows the stage of an unpaid Package', () => {
  assert.equal(describePendingPackage({ workflowStatus: 'AWAITING_PAYMENT' }).workflowLabel, 'Awaiting payment')
  assert.equal(describePendingPackage({ workflowStatus: 'DRAFT' }).workflowLabel, 'Draft')
  assert.equal(describePendingPackage({ workflowStatus: 'OTHER' }).workflowLabel, 'OTHER')
})

test('the Exceptions rows start from the unpaid earlier Packages and can be edited', () => {
  const values = toPackageReleaseValues(row)
  const rows = buildExceptionRows(values)
  assert.deepEqual(rows.map(({ date, amount, include }) => ({ date, amount, include })), [
    { date: '2026-09-20', amount: '1200', include: true },
    { date: '2026-10-05', amount: '845.5', include: true },
  ])

  const edited = [
    { ...rows[0], amount: '1,250.00' },
    { ...rows[1], include: false },
    { ...newManualExceptionRow('manual-1'), date: '2026-08-01', amount: '300' },
    { ...newManualExceptionRow('manual-2'), date: '', amount: '  ' },
  ]
  assert.deepEqual(buildExceptionFillValues(edited), {
    waiver_release_dates: ['2026-09-20', '2026-08-01'],
    unpaid_progress_amount: ['1,250.00', '300'],
    disputed_claims_amount: 1550,
  })
})

test('the Final form gets the unpaid earlier amounts added up for Disputed claims', () => {
  const values = toPackageReleaseValues(row)
  assert.equal(sumAmounts([1200, '845.50', '$1,000', 'nope', null]), 3045.5)
  assert.equal(sumAmounts([]), '')
  assert.equal(sumAmounts([null, '']), '')
  assert.equal(sumAmounts([0.1, 0.2]), 0.3)

  assert.equal(buildPackageFillValues(values).disputed_claims_amount, 2045.5)
  assert.equal(buildPackageFillValues(values, []).disputed_claims_amount, '')
  assert.equal(
    buildExceptionFillValues([{ ...buildExceptionRows(values)[0], include: false }]).disputed_claims_amount,
    '',
  )
  assert.equal(formatReleaseValue('disputed_claims_amount', 'currency', 2045.5), '$2,045.50')
  assert.equal(describeFillPlan({
    fields: [{ variable: 'disputed_claims_amount' }],
  }).filled[0].label, 'Disputed Claims for Extras')
})

test('a Final Release says what it is final for, from the Builder setup', () => {
  assert.equal(
    buildFinalReleaseNote({ scope: 'PHASE', closing: ['Phase 5'], jobCode: '1307' }),
    'Final release per Phase: Phase 5',
  )
  assert.equal(
    buildFinalReleaseNote({ scope: 'PHASE', closing: ['Phase 5', 'Phase 6'] }),
    'Final release per Phase: Phase 5, Phase 6',
  )
  assert.equal(
    buildFinalReleaseNote({ scope: 'BUILDING', closing: ['Phase 2 - Building 15'] }),
    'Final release per Building: Phase 2 - Building 15',
  )
  // A Phase without a Building is named by the Phase alone.
  assert.equal(
    buildFinalReleaseNote({ scope: 'BUILDING', closing: ['Phase 2'] }),
    'Final release per Building: Phase 2',
  )
  assert.equal(
    buildFinalReleaseNote({ scope: 'PROJECT', closing: ['the Job'], jobCode: '1307' }),
    'Final release per Project (Job #1307)',
  )
  assert.equal(buildFinalReleaseNote({ scope: 'PROJECT', closing: [] }), 'Final release per Project')
  assert.equal(buildFinalReleaseNote({ scope: 'PHASE', closing: [] }), 'Final release per Phase')
  // Nothing to say when the setup does not choose a scope.
  assert.equal(buildFinalReleaseNote({ scope: null, closing: ['Phase 1'] }), null)
  assert.equal(buildFinalReleaseNote({ scope: undefined }), null)
})
