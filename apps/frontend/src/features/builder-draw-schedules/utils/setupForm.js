// The Builder setup form, read as a setup: what the live summary and the comparison show while
// it is being filled, and what is still missing before it can be saved. Pure: nothing here
// touches the network or React.

import { isNamedSubmissionMethod } from '../data/builderDrawSchedules.js'
import { percentageFromFraction } from '../schemas/builderDrawScheduleSchema.js'
import { normalizeLag } from './drawLag.js'
import { formatSetupPercentage } from './setupSummary.js'

function toNumber(value) {
  if (value === '' || value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function eventPercentages(values = {}) {
  return { EXT: toNumber(values.EXT) ?? 0, DM: toNumber(values.DM) ?? 0, HW: toNumber(values.HW) ?? 0 }
}

/**
 * The values of the form (strings and all, as typed) as a setup the summary helpers read. A
 * retention typed as a fraction (0.0833) counts as the percentage it stands for (8.33%), as it
 * does when the form is saved.
 */
export function setupFromFormValues(values = {}) {
  const retention = percentageFromFraction(values.retentionPercentage) ?? toNumber(values.retentionPercentage) ?? 0
  const optionsDraw = toNumber(values.optionsBillingDrawIndex)

  return {
    builderId: toNumber(values.builderId),
    draws: (values.draws ?? []).map((draw) => ({
      name: String(draw?.name ?? '').trim(),
      percentage: toNumber(draw?.percentage) ?? 0,
      eventType: draw?.eventType ?? '',
      lag: normalizeLag(draw?.lag),
    })),
    optionsBillingDrawIndex: optionsDraw,
    separateHardwarePrice: Boolean(values.separateHardwarePrice),
    hardwareEventPercentages: eventPercentages(values.hardwareEventPercentages),
    utilityBuilding: Boolean(values.utilityBuilding),
    utilityBillingMode: values.utilityBillingMode === 'BY_EVENT' ? 'BY_EVENT' : 'FULL',
    utilityEventPercentages: eventPercentages(values.utilityEventPercentages),
    frequency: values.frequency,
    anyDate: Boolean(values.anyDate),
    cutoffDay: toNumber(values.cutoffDay),
    cutoffDays: (values.cutoffDays ?? [])
      .map(toNumber)
      .filter((day) => Number.isInteger(day) && day > 0),
    cutoffWeekday: toNumber(values.cutoffWeekday) ?? 0,
    paymentTermsDays: toNumber(values.paymentTermsDays),
    retentionEnabled: Boolean(values.retentionEnabled),
    retentionPercentage: retention,
    retentionReleaseScope: values.retentionReleaseScope,
    ocipWrapEnabled: Boolean(values.ocipWrapEnabled),
    ocipWrapPercentage: toNumber(values.ocipWrapPercentage) ?? 0,
    requiresPo: Boolean(values.requiresPo),
    requiresPaymentSchedule: Boolean(values.requiresPaymentSchedule),
    requiresRelease: Boolean(values.requiresRelease),
    finalReleaseScope: values.finalReleaseScope ?? '',
    singleInvoiceScope: values.singleInvoiceScope ?? '',
    requiresBackup: Boolean(values.requiresBackup),
    invoiceLineFormat: values.invoiceLineFormat,
    submissionMethod: values.submissionMethod,
    // Textura, Supply Pro, KB IE and KB LA name the destination themselves: nothing typed under another method goes with them.
    submissionDestination: isNamedSubmissionMethod(values.submissionMethod)
      ? ''
      : String(values.submissionDestination ?? '').trim(),
    notes: String(values.notes ?? '').trim(),
  }
}

const FIELD_LABELS = {
  builderId: 'Builder',
  optionsBillingDrawIndex: 'Options',
  hardwareEventPercentages: 'Hardware',
  utilityEventPercentages: 'Utility',
  frequency: 'Cutoff',
  cutoffDay: 'Cutoff',
  cutoffDays: 'Cutoff',
  cutoffWeekday: 'Cutoff',
  paymentTermsDays: 'Payment terms',
  retentionPercentage: 'Retention',
  ocipWrapPercentage: 'OCIP / WRAP',
  finalReleaseScope: 'Release',
  singleInvoiceScope: 'Single invoice',
  submissionDestination: 'Submission',
  notes: 'Notes',
}

// The parts of the form, in the order they are filled, and what each is called on screen.
export const SETUP_SECTIONS = {
  builder: 'Builder',
  draws: 'Draws',
  hardware: 'Hardware and Utility',
  cycle: 'Billing cycle',
  deductions: 'Deductions',
  submission: 'Documents and submission',
}

const SECTION_OF_FIELD = {
  builderId: 'builder',
  draws: 'draws',
  optionsBillingDrawIndex: 'draws',
  separateHardwarePrice: 'hardware',
  hardwareBillingMode: 'hardware',
  hardwareEventPercentages: 'hardware',
  utilityBuilding: 'hardware',
  utilityBillingMode: 'hardware',
  utilityEventPercentages: 'hardware',
  frequency: 'cycle',
  anyDate: 'cycle',
  cutoffDay: 'cycle',
  cutoffDays: 'cycle',
  cutoffWeekday: 'cycle',
  paymentTermsDays: 'cycle',
  retentionEnabled: 'deductions',
  retentionPercentage: 'deductions',
  retentionReleaseScope: 'deductions',
  ocipWrapEnabled: 'deductions',
  ocipWrapPercentage: 'deductions',
}

/**
 * Where an issue lives on the form: the part it belongs to, and the name of the field to take the
 * person to. `path` is the path the schema reports (`['draws', 2, 'percentage']`). A problem that
 * belongs to the whole list of Draws (their total) leads to the first percentage.
 */
export function locateFormIssue(path = []) {
  const [field, index, detail] = path
  const section = SECTION_OF_FIELD[field] ?? 'submission'

  if (field === 'draws') {
    if (index === undefined) return { section, name: 'draws.0.percentage' }
    return { section, name: `draws.${index}.${detail ?? 'percentage'}` }
  }
  if (field === 'hardwareEventPercentages') {
    return { section, name: `hardwareEventPercentages.${index ?? 'EXT'}` }
  }
  if (field === 'utilityEventPercentages') {
    return { section, name: `utilityEventPercentages.${index ?? 'EXT'}` }
  }
  if (field === 'cutoffDays') return { section, name: 'cutoffDays.0' }
  return { section, name: field }
}

/**
 * What stops the form from being saved, as short lines a person can act on, each with where it is
 * on the form, from the issues the schema reports (`schema.safeParse(values).error.issues`). The
 * same line is listed once.
 */
export function describeFormIssueTargets(issues = [], values = {}) {
  const drawTotal = (values.draws ?? []).reduce((sum, draw) => sum + (toNumber(draw?.percentage) ?? 0), 0)
  const seen = new Set()
  const lines = []

  for (const issue of issues) {
    const [field, index, detail] = issue.path
    let text
    if (field === 'draws' && index === undefined) {
      text = drawTotal > 0 && Math.abs(drawTotal - 100) > 0.001
        ? `Draws add up to ${formatSetupPercentage(Math.round(drawTotal * 1000) / 1000)}%, not 100%`
        : issue.message.replace(/\.$/u, '')
    } else if (field === 'draws') {
      text = `Draw ${Number(index) + 1}${detail === 'lag' ? ' lag' : ''}: ${issue.message.replace(/\.$/u, '')}`
    } else {
      const label = FIELD_LABELS[field]
      const message = issue.message.replace(/\.$/u, '')
      text = label && field !== 'builderId' ? `${label}: ${message}` : message
    }
    if (!seen.has(text)) {
      seen.add(text)
      lines.push({ text, ...locateFormIssue(issue.path) })
    }
  }

  return lines
}

/** The same lines as plain text, for the places that only say what is missing. */
export function describeFormIssues(issues = [], values = {}) {
  return describeFormIssueTargets(issues, values).map(({ text }) => text)
}

/** How many lines each part of the form has: `{ draws: 2, cycle: 1 }`. */
export function countIssuesBySection(targets = []) {
  return targets.reduce((counts, { section }) => ({ ...counts, [section]: (counts[section] ?? 0) + 1 }), {})
}

// What the database says when it refuses a setup, in the words of the form and tied to the field it
// is about. The database speaks of its own rules, sometimes in Spanish; a person needs the field.
const SERVER_REASONS = [
  [/already has an active billing setup|select an active builder/iu, 'builderId', 'builder',
    (message) => (/already has/iu.test(message)
      ? 'This builder already has an active billing setup.'
      : 'Select an active builder that still exists.')],
  [/porcentajes de los draws deben sumar 100/iu, 'draws.0.percentage', 'draws', () => 'Draw percentages must total exactly 100%.'],
  [/entre 2 y 5 draws/iu, 'draws.0.percentage', 'draws', () => 'Configure between 2 and 5 draws.'],
  [/event type EXT, DM o HW/iu, 'draws.0.eventType', 'draws', () => 'Every Draw needs an event: EXT, DM or HW.'],
  [/draw lag needs another draw/iu, 'draws.0.percentage', 'draws', () => 'A Draw lag needs another Draw with the same event.'],
  [/draws deben ser consecutivos/iu, 'draws.0.percentage', 'draws', () => 'The Draws must be numbered one after another.'],
  [/draw configurado para options/iu, 'optionsBillingDrawIndex', 'draws', () => 'Select one of the configured Draws to bill Options.'],
  [/draw configurado para hardware/iu, 'hardwareEventPercentages.EXT', 'hardware', () => 'The Draw set for Hardware does not exist.'],
  [/hardware event percentages must total|separate hardware setups must allocate/iu, 'hardwareEventPercentages.EXT', 'hardware',
    () => 'Hardware event percentages must total exactly 100%.'],
  [/utility (event percentages|allocation)/iu, 'utilityEventPercentages.EXT', 'hardware',
    (message) => (/total/iu.test(message)
      ? 'Utility event percentages must total exactly 100%.'
      : 'Every Utility allocation needs a Draw with that event.')],
  [/conditional final release/iu, 'finalReleaseScope', 'submission',
    (message) => (/needs release/iu.test(message)
      ? 'The Conditional Final Release needs a Release to be required.'
      : 'Select where the Conditional Final Release applies.')],
  [/single invoice/iu, 'singleInvoiceScope', 'submission', () => 'Select Per Phase or Per Building for the single invoice.'],
]

/**
 * What a refused save says, and where it belongs: `{ text, name, section }`, with `name` and
 * `section` null when the message is about something no single field holds.
 */
export function explainSaveError(message) {
  const text = String(message ?? '').trim()
  for (const [pattern, name, section, say] of SERVER_REASONS) {
    if (pattern.test(text)) return { text: say(text), name, section }
  }
  return { text, name: null, section: null }
}
