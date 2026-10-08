import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPackageDocumentStoragePath,
  buildPackageFillValues,
  buildPackageReleaseFileName,
  describeFillPlan,
  describePendingPackage,
  pickDefaultTemplate,
  sha256Hex,
  sortTemplatesByType,
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
      workflow_status: 'READY_TO_SUBMIT',
    },
  ],
}

test('the values row maps to the model the screen uses', () => {
  assert.deepEqual(toPackageReleaseValues(row), {
    packageId: 46,
    jobId: 22,
    packageNumber: 'DP-00000046',
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
        workflowStatus: 'READY_TO_SUBMIT',
      },
    ],
  })
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

test('templates are offered in the order of the four Release types', () => {
  const templates = [
    { id: 'c', releaseType: 'UnconditionalWaiverAndReleaseOnFinalPayment' },
    { id: 'a', releaseType: 'ConditionalWaiverAndReleaseOnFinalPayment' },
    { id: 'b', releaseType: 'UnconditionalWaiverAndReleaseOnProgressPayment' },
  ]
  assert.deepEqual(sortTemplatesByType(templates).map(({ id }) => id), ['a', 'b', 'c'])
  assert.equal(pickDefaultTemplate(templates).id, 'a')
  assert.equal(pickDefaultTemplate([]), null)
  // The input is not reordered.
  assert.equal(templates[0].id, 'c')
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
  assert.equal(describePendingPackage({ workflowStatus: 'READY_TO_SUBMIT' }).workflowLabel, 'Ready to submit')
  assert.equal(describePendingPackage({ workflowStatus: 'DRAFT' }).workflowLabel, 'Draft')
  assert.equal(describePendingPackage({ workflowStatus: 'OTHER' }).workflowLabel, 'OTHER')
})
