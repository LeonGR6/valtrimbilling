import { assertEquals } from '@std/assert'
import {
  CUSTOM_FIELD_MAX_LENGTH,
  matchJobCustomFields,
  normalizeCustomFieldLabel,
  parseCustomFieldDefinitions,
} from './quickbooksCustomFields.ts'

// Shape of Preferences.SalesFormsPrefs.CustomField: groups of Name/value entries.
const preferences = (entries: Record<string, unknown>[]) => ({
  Preferences: { SalesFormsPrefs: { CustomField: [{ CustomField: entries }] } },
})

const names = (...labels: (string | null)[]) =>
  labels.flatMap((label, index) => [
    { Name: `SalesFormsPrefs.SalesCustomName${index + 1}`, Type: 'StringType', StringValue: label ?? '' },
    { Name: `SalesFormsPrefs.UseSalesCustom${index + 1}`, Type: 'BooleanType', BooleanValue: label !== null },
  ])

Deno.test('reads the custom field labels and on/off flags from Preferences', () => {
  assertEquals(parseCustomFieldDefinitions(preferences(names('Job Name', 'Job #', null))), [
    { definitionId: '1', label: 'Job Name', enabled: true },
    { definitionId: '2', label: 'Job #', enabled: true },
  ])
})

Deno.test('matches entries by name, not by position, and tolerates nesting and gaps', () => {
  const shuffled = preferences([...names('Job Name', 'Job #')].reverse())
  assertEquals(parseCustomFieldDefinitions(shuffled).map(({ label }) => label), ['Job Name', 'Job #'])

  assertEquals(parseCustomFieldDefinitions({}), [])
  assertEquals(parseCustomFieldDefinitions(null), [])
  assertEquals(
    parseCustomFieldDefinitions({ Preferences: { SalesFormsPrefs: { CustomField: [{ CustomField: [{ Name: 'x' }] }] } } }),
    [],
  )
})

Deno.test('a label switched off stays defined but disabled; a missing flag counts as on', () => {
  const body = preferences([
    { Name: 'SalesFormsPrefs.SalesCustomName1', StringValue: 'Job Name' },
    { Name: 'SalesFormsPrefs.UseSalesCustom1', BooleanValue: false },
    { Name: 'SalesFormsPrefs.SalesCustomName2', StringValue: 'Job #' },
  ])
  assertEquals(parseCustomFieldDefinitions(body), [
    { definitionId: '1', label: 'Job Name', enabled: false },
    { definitionId: '2', label: 'Job #', enabled: true },
  ])
})

Deno.test('normalizes labels so "Job #" and "Job Number" are the same field', () => {
  assertEquals(normalizeCustomFieldLabel('Job #'), 'job number')
  assertEquals(normalizeCustomFieldLabel('  Job   Name (Community) '), 'job name')
})

const defs = (labels: string[], enabled = true) =>
  labels.map((label, index) => ({ definitionId: String(index + 1), label, enabled }))

Deno.test('fills Job Name with the community and Job # with the job code', () => {
  const { fields, warnings } = matchJobCustomFields(defs(['Job Name', 'Job #']), {
    jobName: 'Sunset Ridge',
    jobNumber: '1307',
  })

  assertEquals(fields, [
    { definitionId: '1', name: 'Job Name', value: 'Sunset Ridge' },
    { definitionId: '2', name: 'Job #', value: '1307' },
  ])
  assertEquals(warnings, [])
})

Deno.test('uses the definition ids of the company, whatever order they are in', () => {
  const { fields } = matchJobCustomFields(defs(['PO Number', 'Job #', 'Job Name']), {
    jobName: 'Sunset Ridge',
    jobNumber: '1307',
  })

  assertEquals(fields.map(({ definitionId, name }) => [definitionId, name]), [
    ['3', 'Job Name'],
    ['2', 'Job #'],
  ])
})

Deno.test('says when a field does not exist, is off, or the Job has no value', () => {
  const missing = matchJobCustomFields(defs(['PO Number']), { jobName: 'X', jobNumber: '1' })
  assertEquals(missing.fields, [])
  assertEquals(missing.warnings.length, 2)
  assertEquals(missing.warnings[0].includes('no "Job Name" custom field'), true)

  const off = matchJobCustomFields(defs(['Job Name', 'Job #'], false), { jobName: 'X', jobNumber: '1' })
  assertEquals(off.fields, [])
  assertEquals(off.warnings[0], 'The QuickBooks custom field "Job Name" is turned off, so it was left empty.')

  const empty = matchJobCustomFields(defs(['Job Name', 'Job #']), { jobName: null, jobNumber: ' ' })
  assertEquals(empty.fields, [])
  assertEquals(empty.warnings[0].includes('no community'), true)
  assertEquals(empty.warnings[1].includes('no number'), true)
})

Deno.test('cuts values longer than the QuickBooks limit and reports it', () => {
  const long = 'A'.repeat(CUSTOM_FIELD_MAX_LENGTH + 9)
  const { fields, warnings } = matchJobCustomFields(defs(['Job Name']), { jobName: long, jobNumber: '1' })

  assertEquals(fields[0].value, 'A'.repeat(CUSTOM_FIELD_MAX_LENGTH))
  assertEquals(warnings.some((warning) => warning.includes('shortened to 31 characters')), true)
})
