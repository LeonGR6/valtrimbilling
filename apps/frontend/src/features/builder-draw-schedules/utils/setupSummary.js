// How a Builder billing setup (one version of it) reads in a summary: the figures a person
// checks before a Job uses it, and the rest of what it holds. Pure: nothing here touches the
// network or React.

import {
  finalReleaseScopeLabels,
  frequencyLabels,
  invoiceLineFormatLabels,
  retentionReleaseScopeLabels,
  submissionMethodLabels,
  weekdayOptions,
} from '../data/builderDrawSchedules.js'
import { formatLag } from './drawLag.js'

const EVENT_TYPES = ['EXT', 'DM', 'HW']

/** "2", "1.5", "0.125": no trailing zeros. */
export function formatSetupPercentage(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '0'
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(3).replace(/0+$/u, '').replace(/\.$/u, '')
}

function eventSplit(percentages = {}) {
  return EVENT_TYPES
    .filter((type) => Number(percentages[type]) > 0)
    .map((type) => `${type} ${formatSetupPercentage(percentages[type])}%`)
    .join(' · ')
}

function joinDays(days) {
  const list = [...days].sort((a, b) => a - b)
  return list.length > 1
    ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
    : String(list[0] ?? '')
}

/** When the Builder bills: "Any date", "Monthly · day 10", "Twice a month · days 8 and 22"… */
export function describeCutoff(setup) {
  if (setup.anyDate) return 'Any date'

  const frequency = frequencyLabels[setup.frequency] ?? setup.frequency ?? ''
  if (setup.frequency === 'MONTHLY') return `${frequency} · day ${setup.cutoffDay}`
  if (setup.frequency === 'SEMIMONTHLY') {
    return `${frequency} · days ${joinDays(setup.cutoffDays ?? [])}`
  }
  if (setup.frequency === 'WEEKLY') {
    const weekday = weekdayOptions.find((option) => option.value === Number(setup.cutoffWeekday))
    return `${frequency} · ${weekday?.label ?? ''}`.trim()
  }
  return frequency
}

function describeRetention(setup) {
  if (!setup.retentionEnabled) return 'Off'
  const scope = retentionReleaseScopeLabels[setup.retentionReleaseScope]
  return `${formatSetupPercentage(setup.retentionPercentage)}%${scope ? ` · released ${scope.toLowerCase()}` : ''}`
}

function describeWrap(setup) {
  return setup.ocipWrapEnabled ? `${formatSetupPercentage(setup.ocipWrapPercentage)}%` : 'Off'
}

function describeHardware(setup) {
  if (!setup.separateHardwarePrice) return 'Included in the Plan price'
  const split = eventSplit(setup.hardwareEventPercentages)
  return split ? `Separate price · ${split}` : 'Separate price'
}

function describeUtility(setup) {
  if (!setup.utilityBuilding) return 'Off'
  if (setup.utilityBillingMode === 'BY_EVENT') {
    const split = eventSplit(setup.utilityEventPercentages)
    return split ? `On · split by event · ${split}` : 'On · split by event'
  }
  return 'On · charged in one package'
}

function describeSubmission(setup) {
  const method = submissionMethodLabels[setup.submissionMethod] ?? 'Portal'
  const destination = String(setup.submissionDestination ?? '').trim()
  return destination ? `${method} · ${destination}` : method
}

function describeDocuments(setup) {
  const documents = [
    setup.requiresPo && 'Purchase order',
    setup.requiresPaymentSchedule && 'Payment schedule',
    setup.requiresRelease
      && (setup.finalReleaseScope
        ? `Release (final ${String(finalReleaseScopeLabels[setup.finalReleaseScope] ?? '').toLowerCase()})`
        : 'Release'),
    setup.requiresBackup && 'Backup documentation',
  ].filter(Boolean)
  return documents.length > 0 ? documents.join(' · ') : 'None required'
}

/**
 * What a person checks first: the figures that change what a Package bills. `retention` and
 * `wrap` are flagged when they are on.
 */
export function describeSetupFigures(setup) {
  return [
    { key: 'retention', label: 'Retention', value: describeRetention(setup), on: Boolean(setup.retentionEnabled) },
    { key: 'wrap', label: 'OCIP / WRAP', value: describeWrap(setup), on: Boolean(setup.ocipWrapEnabled) },
    { key: 'payment', label: 'Payment terms', value: setup.paymentTermsDays == null ? '—' : `Net ${setup.paymentTermsDays} days`, on: true },
    { key: 'cutoff', label: 'Cutoff', value: describeCutoff(setup), on: true },
  ]
}

/** The Draws in order, with what each bills and when it becomes billable. */
export function describeSetupDraws(setup) {
  const draws = (setup.draws ?? []).map((draw, index) => ({
    number: index + 1,
    name: String(draw.name ?? '').trim(),
    eventType: draw.eventType ?? '',
    percentage: formatSetupPercentage(draw.percentage),
    lag: formatLag(draw.lag),
    billsOptions: setup.optionsBillingDrawIndex === index,
  }))
  const total = (setup.draws ?? []).reduce((sum, draw) => sum + (Number(draw.percentage) || 0), 0)
  return {
    draws,
    total: formatSetupPercentage(Math.round(total * 1000) / 1000),
    totalIsComplete: Math.abs(total - 100) < 0.0005,
  }
}

/** The rest of the setup, as label and value. */
export function describeSetupDetails(setup) {
  return [
    { label: 'Hardware', value: describeHardware(setup) },
    { label: 'Utility building', value: describeUtility(setup) },
    {
      label: 'Options are billed in',
      value: setup.optionsBillingDrawIndex == null
        ? 'Not set'
        : `Draw ${Number(setup.optionsBillingDrawIndex) + 1}`,
    },
    { label: 'Invoice lines', value: invoiceLineFormatLabels[setup.invoiceLineFormat] ?? '—' },
    { label: 'Submitted by', value: describeSubmission(setup) },
    { label: 'Required documents', value: describeDocuments(setup) },
    ...(String(setup.notes ?? '').trim() ? [{ label: 'Notes', value: String(setup.notes).trim() }] : []),
  ]
}

/** One line for a collapsed header: "Retention 5% · OCIP / WRAP 2% · Net 30 days". */
export function describeSetupHeadline(setup) {
  return describeSetupFigures(setup)
    .filter(({ key }) => key !== 'cutoff')
    .map(({ label, value }) => `${label} ${value.split(' · ')[0]}`)
    .join(' · ')
}

/**
 * Two versions side by side: one row per figure, Draw and detail, with what each says and whether
 * it differs. Rows that differ come first within their group so a change cannot be missed.
 */
export function diffSetups(current, next) {
  const row = (group, label, from, to) => ({ group, label, from, to, changed: from !== to })

  const figures = describeSetupFigures(current).map((figure, index) => {
    const other = describeSetupFigures(next)[index]
    return row('Billing', figure.label, figure.value, other.value)
  })

  const drawLine = (draw) => (draw
    ? `${draw.percentage}% · ${[draw.eventType, draw.lag ? `${draw.lag} after` : null].filter(Boolean).join(' · ')}`
    : '—')
  const currentDraws = describeSetupDraws(current).draws
  const nextDraws = describeSetupDraws(next).draws
  const draws = Array.from(
    { length: Math.max(currentDraws.length, nextDraws.length) },
    (_, index) => row('Draws', `Draw ${index + 1}`, drawLine(currentDraws[index]), drawLine(nextDraws[index])),
  )

  // Every detail either version has: a note added where there was none still shows up.
  const currentDetails = describeSetupDetails(current)
  const nextDetails = describeSetupDetails(next)
  const labels = [...new Set([...currentDetails, ...nextDetails].map(({ label }) => label))]
  const details = labels.map((label) => row(
    'Other',
    label,
    currentDetails.find((detail) => detail.label === label)?.value ?? '—',
    nextDetails.find((detail) => detail.label === label)?.value ?? '—',
  ))

  const rows = [...figures, ...draws, ...details]
  return { rows, changedCount: rows.filter(({ changed }) => changed).length }
}
