import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPackageDocumentStoragePath,
  buildPackageFillValues,
  buildPackageReleaseFileName,
  describeFillPlan,
  pickDefaultTemplate,
  sha256Hex,
  sortTemplatesByType,
  toPackageReleaseValues,
} from '../src/features/release-templates/services/packageRelease.js'
import { formatReleaseValue } from '../src/features/release-templates/services/releaseValueFormat.js'

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
  })
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

  assert.deepEqual(plan.filled.map(({ key }) => key), ['through_date', 'check_amount', 'signature_date'])
  assert.deepEqual(plan.blank.map(({ key }) => key), ['waiver_release_dates', 'unpaid_progress_amount'])
  assert.deepEqual(plan.missingFromForm, [])
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
