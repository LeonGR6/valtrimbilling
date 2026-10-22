// How the documents of a Job are arranged on the Documents screen. Pure: nothing here
// touches the network or React.
//
// Payment Schedules and Purchase Orders are grouped by the Phase they belong to, which
// is read from what was already analyzed:
//   - a Purchase Order: the Phase of the Lots its lines were matched with;
//   - a Payment Schedule: the Phase of its cells (the Job Phase a reviewer chose, or the
//     one suggested from the Phase printed in the PDF).
// A document that touches several Phases is listed in each of them. One whose Phase
// cannot be told goes to "Not matched to a phase", with the reason.

import { normalizeCodeKey, suggestJobPhase } from '../../payment-schedules/services/paymentScheduleRecord.js'
import { summarizeComparison } from '../../purchase-orders/services/purchaseOrderRecord.js'
import { formatLotRange } from './drawPackages.js'

// --- Phases ------------------------------------------------------------------

/** Key to compare Phases: "Phase 003", "003" and "3" are the same one; case does not count. */
export function phaseKey(code) {
  return normalizeCodeKey(String(code ?? '').replace(/^\s*phase[\s#:.-]*/iu, ''))
}

/** "Phase 3" for a short code, the word itself ("Models") for a name. */
export function phaseLabel(code) {
  const text = String(code ?? '').trim().replace(/^phase[\s#:.-]*/iu, '')
  if (text === '') return 'Phase'
  if (/^\d+$/u.test(text)) return `Phase ${Number(text)}`
  if (/^[0-9A-Za-z]{1,3}$/u.test(text)) return `Phase ${text.toUpperCase()}`
  return `${text.charAt(0).toUpperCase()}${text.slice(1).toLowerCase()}`
}

/**
 * The Phases of a Job, one per code (the same Phase in several buildings is one), in
 * the order of the Sequence Sheet.
 */
export function jobPhaseList(job) {
  const seen = new Map()
  for (const phase of job?.sequenceSheet?.phases ?? []) {
    const key = phaseKey(phase.name ?? phase.code)
    if (key === '') continue
    const entry = seen.get(key) ?? {
      key,
      code: String(phase.name ?? phase.code),
      label: phaseLabel(phase.name ?? phase.code),
      ids: [],
    }
    entry.ids.push(Number(phase.id))
    seen.set(key, entry)
  }
  return [...seen.values()]
}

function phaseOfId(phases, id) {
  return phases.find((phase) => phase.ids.includes(Number(id))) ?? null
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

// --- Purchase Orders -----------------------------------------------------------

const PO_REASONS = {
  analyzing: { reason: 'Analyzing…', tone: 'info' },
  failed: { reason: 'The analysis failed', tone: 'error' },
  not_option_po: { reason: 'Not a Purchase Order of options', tone: 'neutral' },
}

/**
 * The Purchase Orders of a Job by Phase.
 *  - `analyses`: analysis of each document id.
 *  - `lotsByAnalysis`: for each analysis id, the lines' `{ phaseId, lotRaw }` as stored.
 *  - `comparison`: the current lines compared with the system (their status per option).
 */
export function purchaseOrderGroups({
  documents,
  phases,
  analyses = {},
  lotsByAnalysis = new Map(),
  comparison = [],
}) {
  const byPhase = new Map()
  const unassigned = []

  for (const document of documents) {
    const analysis = analyses[document.id] ?? null
    if (!analysis) {
      unassigned.push({ document, reason: 'Not analyzed yet', tone: 'neutral' })
      continue
    }
    if (analysis.status !== 'analyzed') {
      unassigned.push({
        document,
        ...(PO_REASONS[analysis.status] ?? { reason: 'Not analyzed yet', tone: 'neutral' }),
      })
      continue
    }

    const lots = new Map()
    for (const line of lotsByAnalysis.get(analysis.id) ?? []) {
      const phase = line.phaseId == null ? null : phaseOfId(phases, line.phaseId)
      if (!phase) continue
      const set = lots.get(phase.key) ?? new Set()
      if (line.lotRaw) set.add(String(line.lotRaw))
      lots.set(phase.key, set)
    }

    if (lots.size === 0) {
      unassigned.push({ document, reason: 'Its lot is not in this Job', tone: 'error' })
      continue
    }

    const keys = [...lots.keys()]
    for (const key of keys) {
      const phase = phases.find((candidate) => candidate.key === key)
      const lines = comparison.filter((line) =>
        line.documentId === document.id && phase.ids.includes(Number(line.phaseId)))
      const summary = summarizeComparison(lines)
      const placement = {
        document,
        lots: [...lots.get(key)],
        summary,
        alsoIn: keys.filter((other) => other !== key)
          .map((other) => phases.find((candidate) => candidate.key === other).label),
      }
      byPhase.set(key, [...(byPhase.get(key) ?? []), placement])
    }
  }

  const groups = phases
    .filter((phase) => byPhase.has(phase.key))
    .map((phase) => {
      const placements = byPhase.get(phase.key)
      const lots = placements.flatMap((placement) => placement.lots)
      const attention = placements.reduce((total, placement) => total + placement.summary.attention, 0)
      return {
        key: phase.key,
        label: phase.label,
        placements,
        attention,
        meta: `${plural(placements.length, 'purchase order', 'purchase orders')}, lots ${formatLotRange(lots)}`,
        status: attention > 0 ? 'attention' : 'ok',
        statusLabel: attention > 0 ? `${attention} to review` : 'All match',
      }
    })

  return { groups, unassigned }
}

// --- Payment Schedules ---------------------------------------------------------

function printedPhaseOf(cell) {
  return cell.phase == null ? '' : String(cell.phase).trim()
}

/**
 * The Phases a Payment Schedule covers, from its cells: the Job Phase of a confirmed
 * schedule, or the suggestion for the Phase printed in an unconfirmed one. A schedule
 * that prints no Phase belongs to the only Phase of a Job that has one. Cells whose
 * Phase cannot be told are counted apart.
 */
export function schedulePhaseCoverage(template, phases) {
  const confirmed = template.status === 'confirmed' && template.mapping?.cells
  const cells = confirmed ? template.mapping.cells : template.detectedCells ?? []
  const codes = phases.map((phase) => phase.code)
  const lots = new Map()
  let unmatched = 0
  let unknownPhase = null

  for (const cell of cells) {
    const printed = printedPhaseOf(cell)
    let key
    if (printed === '') {
      key = phases.length === 1 ? phases[0].key : null
    } else {
      const code = confirmed ? printed : suggestJobPhase(printed, codes)
      const phase = code === '' ? null : phases.find((candidate) => candidate.key === phaseKey(code))
      key = phase?.key ?? null
      if (!phase) unknownPhase = unknownPhase ?? printed
    }

    if (key === null) {
      unmatched += 1
      continue
    }
    const set = lots.get(key) ?? new Set()
    set.add(String(cell.lot))
    lots.set(key, set)
  }

  return { lots, unmatched, unknownPhase, cellCount: cells.length }
}

const SCHEDULE_REASONS = {
  analyzing: { reason: 'Analyzing…', tone: 'info' },
  failed: { reason: 'The analysis failed', tone: 'error' },
}

/**
 * The Payment Schedules of a Job by Phase. Every Phase of the Job is listed, those
 * with no schedule too, so a missing one is easy to see.
 */
export function paymentScheduleGroups({ documents, phases, templates = {} }) {
  // A Job with no Phases yet has nothing to group by: its schedules are a plain list.
  if (phases.length === 0) {
    return {
      groups: [],
      unassigned: [],
      flat: true,
      review: documents.filter(({ id }) => templates[id]?.status !== 'confirmed').length,
    }
  }

  const byPhase = new Map()
  const unassigned = []

  for (const document of documents) {
    const template = templates[document.id] ?? null
    if (!template) {
      unassigned.push({ document, reason: 'Not analyzed yet', tone: 'neutral' })
      continue
    }
    if (template.status === 'failed' || template.status === 'analyzing') {
      unassigned.push({ document, ...SCHEDULE_REASONS[template.status] })
      continue
    }

    const coverage = schedulePhaseCoverage(template, phases)
    if (coverage.lots.size === 0) {
      unassigned.push({
        document,
        reason: coverage.unknownPhase
          ? `Its Phase (${coverage.unknownPhase}) is not in this Job`
          : 'It prints no Phase. Choose one when you review it',
        tone: 'warning',
      })
      continue
    }

    const keys = [...coverage.lots.keys()]
    for (const key of keys) {
      const placement = {
        document,
        template,
        lots: [...coverage.lots.get(key)],
        alsoIn: keys.filter((other) => other !== key)
          .map((other) => phases.find((candidate) => candidate.key === other).label),
      }
      byPhase.set(key, [...(byPhase.get(key) ?? []), placement])
    }
  }

  const groups = phases.map((phase) => {
    const placements = byPhase.get(phase.key) ?? []
    const needsReview = placements.filter(({ template }) => template.status !== 'confirmed').length
    const lots = placements.flatMap((placement) => placement.lots)
    const empty = placements.length === 0
    return {
      key: phase.key,
      label: phase.label,
      placements,
      empty,
      attention: needsReview,
      meta: empty
        ? 'No payment schedule yet'
        : `${plural(placements.length, 'schedule', 'schedules')}, lots ${formatLotRange(lots)}`,
      status: empty ? 'missing' : needsReview > 0 ? 'attention' : 'ok',
      statusLabel: empty ? 'Missing' : needsReview > 0 ? 'Needs review' : 'Ready',
    }
  })

  return { groups, unassigned, flat: false, review: 0 }
}

// --- One section of the Job -------------------------------------------------------

/**
 * The state of a section, for its rail, its summary line and its badge.
 * `tone`: ok (green), attention (amber), missing (red, a required one) or idle (gray).
 */
export function summarizeSection({
  type,
  required,
  documents,
  releaseTemplates = {},
  scheduleGroups = null,
  purchaseOrderGroups: purchaseGroups = null,
}) {
  const count = documents.length
  const requirement = required ? 'Required' : 'Optional'
  const none = (label) => ({
    tone: required ? 'missing' : 'idle',
    summary: `${requirement}, none yet`,
    badge: required ? { color: 'error', label } : null,
  })

  switch (type) {
    case 'preliminary-notice': {
      if (documents.some(({ isComplete }) => isComplete !== false)) {
        return { tone: 'ok', summary: `${requirement}, filled in`, badge: { color: 'success', label: 'Complete' } }
      }
      return count > 0
        ? { tone: 'attention', summary: `${requirement}, blanks still empty`, badge: { color: 'warning', label: 'Incomplete' } }
        : none('Missing')
    }

    case 'release': {
      if (count === 0) return none('Missing')
      const ready = documents.filter(({ id }) => releaseTemplates[id]?.status === 'confirmed').length
      const toReview = count - ready
      return toReview > 0
        ? {
          tone: 'attention',
          summary: `${plural(count, 'file', 'files')}, ${ready} template ready`,
          badge: { color: 'warning', label: `${toReview} to review` },
        }
        : {
          tone: 'ok',
          summary: plural(count, 'file', 'files'),
          badge: { color: 'success', label: 'Ready' },
        }
    }

    case 'payment-schedule': {
      if (count === 0) return none('Missing')
      const { groups, unassigned } = scheduleGroups
      if (scheduleGroups.flat) {
        const summary = plural(count, 'file', 'files')
        return scheduleGroups.review > 0
          ? { tone: 'attention', summary, badge: { color: 'warning', label: `${scheduleGroups.review} to review` } }
          : { tone: 'ok', summary, badge: { color: 'success', label: 'Ready' } }
      }
      const total = groups.length
      const covered = groups.filter((group) => !group.empty).length
      const missing = total - covered
      const review = groups.reduce((sum, group) => sum + group.attention, 0)
      const summary = total > 0
        ? `${covered} of ${plural(total, 'phase', 'phases')} covered`
        : plural(count, 'file', 'files')

      if (unassigned.length > 0) {
        return { tone: 'attention', summary, badge: { color: 'warning', label: `${unassigned.length} not matched` } }
      }
      if (review > 0) {
        return { tone: 'attention', summary, badge: { color: 'warning', label: `${review} to review` } }
      }
      if (missing > 0) {
        return { tone: 'attention', summary, badge: { color: 'warning', label: `${plural(missing, 'phase', 'phases')} without one` } }
      }
      return { tone: 'ok', summary, badge: { color: 'success', label: 'Ready' } }
    }

    case 'purchase-order': {
      if (count === 0) return none('Missing')
      const { groups, unassigned } = purchaseGroups
      const attention = groups.reduce((sum, group) => sum + group.attention, 0) + unassigned.length
      const summary = groups.length > 0
        ? `${plural(count, 'purchase order', 'purchase orders')} in ${plural(groups.length, 'phase', 'phases')}`
        : plural(count, 'purchase order', 'purchase orders')
      return attention > 0
        ? { tone: 'attention', summary, badge: { color: 'warning', label: `${attention} to review` } }
        : { tone: 'ok', summary, badge: { color: 'success', label: 'All match' } }
    }

    default: {
      if (count === 0) return none('Missing')
      return { tone: 'ok', summary: plural(count, 'file', 'files'), badge: { color: 'success', label: 'Uploaded' } }
    }
  }
}

/** Lines to show in a section's file filter: only those whose name or lot has the text. */
export function matchesDocumentFilter(document, lots, filter) {
  const text = String(filter ?? '').trim().toLowerCase()
  if (text === '') return true
  return document.name.toLowerCase().includes(text)
    || lots.some((lot) => String(lot).toLowerCase().includes(text))
}
