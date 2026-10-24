// The Builder setup form, read as a setup: what the live summary and the comparison show while
// it is being filled, and what is still missing before it can be saved. Pure: nothing here
// touches the network or React.

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
    requiresBackup: Boolean(values.requiresBackup),
    invoiceLineFormat: values.invoiceLineFormat,
    submissionMethod: values.submissionMethod,
    submissionDestination: String(values.submissionDestination ?? '').trim(),
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
  submissionDestination: 'Submission',
  notes: 'Notes',
}

/**
 * What stops the form from being saved, as short lines a person can act on, from the issues the
 * schema reports (`schema.safeParse(values).error.issues`). The same issue is listed once.
 */
export function describeFormIssues(issues = [], values = {}) {
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
      lines.push(text)
    }
  }

  return lines
}
