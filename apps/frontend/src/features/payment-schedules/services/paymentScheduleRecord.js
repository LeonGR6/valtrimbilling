// Pure helpers for Payment Schedule templates: the persisted record model, the
// cells the reviewer works with and the mapping the database stores. Nothing
// here touches the network or React.

// Only the Payment Schedule card. Some builders send the schedule as a list
// exported from a purchase order; it is still uploaded here.
export const PAYMENT_SCHEDULE_DOCUMENT_TYPES = ['PAYMENT_SCHEDULE']

export const LAYOUTS = {
  matrix: {
    label: 'Matrix',
    description: 'One row per Lot, one column per draw. The amount itself is highlighted.',
  },
  line_items: {
    label: 'List',
    description: 'One row per Lot and draw. The whole row is highlighted.',
  },
}

const ISSUE_LIMIT = 8

const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMoney(value) {
  return Number.isFinite(value) ? moneyFormat.format(value) : '—'
}

export function isPaymentScheduleDocumentType(documentType) {
  return PAYMENT_SCHEDULE_DOCUMENT_TYPES.includes(documentType)
}

export function toPaymentScheduleTemplate(row) {
  const analysis = row.analysis ?? {}
  return {
    id: row.id,
    documentId: row.job_document_id,
    jobId: row.job_id,
    layout: row.layout ?? null,
    detectionMethod: row.detection_method ?? null,
    pageCount: row.page_count ?? 0,
    pageSizes: Array.isArray(row.page_sizes) ? row.page_sizes : [],
    detectedCells: Array.isArray(row.detected_cells) ? row.detected_cells : [],
    draws: Array.isArray(analysis.draws) ? analysis.draws : [],
    issues: Array.isArray(analysis.issues) ? analysis.issues : [],
    // Boxes for the "Previously Invoiced" and "This Request" rows (matrix only).
    summaryRows: analysis.summaryRows ?? null,
    expectedTotal: analysis.expectedTotal ?? null,
    foundTotal: analysis.foundTotal ?? null,
    mapping: row.mapping ?? null,
    status: row.status,
    error: row.error ?? null,
    confirmedAt: row.confirmed_at ?? null,
    analyzedAt: row.analyzed_at ?? null,
    updatedAt: row.updated_at,
  }
}

// --- Cells ------------------------------------------------------------------
//
// A cell is one amount of the schedule: { key, phase, lot, draw, amount, page,
// rect }. The key identifies it inside the editor only; it is not stored.

export function cellKey(cell) {
  return `${cell.phase ?? ''}|${cell.lot}|${cell.draw}`
}

function toEditorCell(cell) {
  return { ...cell, phase: cell.phase ?? null, key: cellKey(cell) }
}

/** What the reviewer starts from: the confirmed cells, else what was detected. */
export function initialCells(template) {
  const source = template.mapping?.cells ?? template.detectedCells
  return source.map(toEditorCell)
}

/**
 * Key to compare a printed Lot or Phase with the system's: case and leading
 * zeros before a digit do not count ("0014" and "14" are the same Lot). The
 * database function private.validate_payment_schedule_mapping keeps the text as
 * printed; every comparison goes through this key.
 */
export function normalizeCodeKey(value) {
  return String(value ?? '').trim().toUpperCase().replace(/^0+(?=\d)/, '')
}

// --- Phases -----------------------------------------------------------------
//
// A builder prints its own Phase code ("MDL") and the platform stores another
// ("MODELS"), and no rule can turn one into the other. The reviewer picks, for
// each Phase printed in the PDF, the Phase of the Job it stands for; the cells
// are then stored with the Job's Phase code, which is what a Package compares.

function isSubsequence(short, long) {
  let index = 0
  for (const character of long) {
    if (character === short[index]) index += 1
    if (index === short.length) return true
  }
  return short.length === 0
}

/**
 * The Job Phase a printed code most likely stands for, or '' when none or more
 * than one could. Equal once normalized ("003" and "3"), else the printed
 * letters appear in order in one Phase code, starting with the same letter
 * ("MDL" and "MDLS" in "MODELS"), else it is the start of one Phase code.
 */
export function suggestJobPhase(printed, jobPhaseCodes) {
  const key = normalizeCodeKey(printed)
  if (key === '') return ''

  const exact = jobPhaseCodes.filter((code) => normalizeCodeKey(code) === key)
  if (exact.length === 1) return exact[0]

  const candidates = jobPhaseCodes.map((code) => ({ code, key: normalizeCodeKey(code) }))
  const only = (matches) => (matches.length === 1 ? matches[0].code : '')

  const abbreviation = only(candidates.filter((candidate) => (
    /^[A-Z]/.test(key)
    && key.length >= 2
    && candidate.key[0] === key[0]
    && candidate.key.length > key.length
    && isSubsequence(key, candidate.key)
  )))
  if (abbreviation) return abbreviation

  return only(candidates.filter((candidate) => (
    key.length >= 2 && candidate.key.startsWith(key) && candidate.key !== key
  )))
}

/** The Phases printed in the PDF, in order of appearance; '' means none printed. */
export function printedPhases(cells) {
  return [...new Set(cells.map((cell) => cell.phase ?? ''))]
}

// A schedule often prints no Phase at all, just Lots. The Job already says which Phase
// each Lot is in (its Sequence Sheet), so the Lots tell the Phases: each Lot goes to the
// Phase that has it, as long as only one does.

/** The choice that sends every cell with no printed Phase to the Phase of its Lot. */
export const PHASE_BY_LOT = '@lots'

/**
 * Which Phases have each Lot of the Job. `jobLots`: `{ lot, phase }`, the Lot number and
 * the code of its Phase. Keyed by the normalized Lot, so "01" finds Lot 1.
 */
export function lotPhaseIndex(jobLots) {
  const index = new Map()
  for (const { lot, phase } of jobLots ?? []) {
    const key = normalizeCodeKey(lot)
    if (key === '' || !phase) continue
    const codes = index.get(key) ?? []
    if (!codes.some((code) => normalizeCodeKey(code) === normalizeCodeKey(phase))) codes.push(phase)
    index.set(key, codes)
  }
  return index
}

/**
 * The Phase a Lot is in: `found` with its code, `several` when more than one Phase has a
 * Lot of that number (the Lot alone cannot tell), `unknown` when the Job has no such Lot.
 */
export function phaseOfLot(lot, index) {
  const codes = index?.get(normalizeCodeKey(lot)) ?? []
  if (codes.length === 1) return { status: 'found', phase: codes[0] }
  return { status: codes.length === 0 ? 'unknown' : 'several', phase: '' }
}

/**
 * What the Lots say about the cells that print no Phase: the Lots of each Phase, those that
 * several Phases have and those the Job does not have. In order of appearance.
 */
export function describeLotPhases(cells, index) {
  const phases = new Map()
  const several = new Set()
  const unknown = new Set()
  for (const cell of cells) {
    if ((cell.phase ?? '') !== '') continue
    const found = phaseOfLot(cell.lot, index)
    if (found.status === 'found') {
      const key = normalizeCodeKey(found.phase)
      const entry = phases.get(key) ?? { phase: found.phase, lots: new Set() }
      entry.lots.add(String(cell.lot))
      phases.set(key, entry)
    } else {
      (found.status === 'several' ? several : unknown).add(String(cell.lot))
    }
  }
  return {
    phases: [...phases.values()].map(({ phase, lots }) => ({ phase, lots: [...lots] })),
    several: [...several],
    unknown: [...unknown],
  }
}

/**
 * One suggestion per printed Phase, as the starting point of the mapping. Where the PDF
 * prints no Phase, the Lots decide when the Job's Lots tell at least one of them.
 */
export function initialPhaseMap(cells, jobPhaseCodes, lotPhases = null) {
  return Object.fromEntries(
    printedPhases(cells).map((printed) => {
      if (printed === '') {
        return [printed, describeLotPhases(cells, lotPhases).phases.length > 0 ? PHASE_BY_LOT : '']
      }
      return [printed, suggestJobPhase(printed, jobPhaseCodes)]
    }),
  )
}

/**
 * Stores each cell under the Job Phase chosen for its printed Phase. A cell sent "by Lot"
 * takes the Phase of its Lot, and stays without one when the Lot does not tell.
 */
export function applyPhaseMap(cells, phaseMap, lotPhases = null) {
  return cells.map((cell) => {
    const target = phaseMap[cell.phase ?? '']
    if (target === PHASE_BY_LOT) {
      const found = phaseOfLot(cell.lot, lotPhases)
      return found.status === 'found' ? { ...cell, phase: found.phase } : cell
    }
    return target ? { ...cell, phase: target } : cell
  })
}

/** Printed Phases left without a Job Phase that exists in the Job. */
export function unmatchedPhases(cells, phaseMap, jobPhaseCodes) {
  const known = new Set(jobPhaseCodes.map(normalizeCodeKey))
  return printedPhases(applyPhaseMap(cells, phaseMap))
    .filter((phase) => phase !== '' && !known.has(normalizeCodeKey(phase)))
}

function toSummaryTarget({ draw, page, rect }) {
  return { draw, page, rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }
}

/** The boxes the reviewer starts from: the confirmed ones, else those just found. */
export function initialSummaryRows(template) {
  return template.mapping?.summaryRows ?? template.summaryRows ?? null
}

export function buildMapping(layout, cells, summaryRows = null) {
  const mapping = {
    version: 1,
    layout,
    cells: cells.map(({ phase, lot, draw, amount, page, rect }) => ({
      phase,
      lot,
      draw,
      amount,
      page,
      rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    })),
  }

  if (layout === 'matrix' && summaryRows) {
    const rows = {}
    if (summaryRows.previouslyInvoiced?.length > 0) {
      rows.previouslyInvoiced = summaryRows.previouslyInvoiced.map(toSummaryTarget)
    }
    if (summaryRows.thisRequest?.length > 0) {
      rows.thisRequest = summaryRows.thisRequest.map(toSummaryTarget)
    }
    if (Object.keys(rows).length > 0) mapping.summaryRows = rows
  }
  return mapping
}

/** Lots in the order the document lists them, each with its cell per draw. */
export function lotRows(cells) {
  const rows = new Map()
  for (const cell of cells) {
    const id = `${cell.phase ?? ''}|${cell.lot}`
    if (!rows.has(id)) {
      rows.set(id, { id, phase: cell.phase, lot: cell.lot, byDraw: {} })
    }
    rows.get(id).byDraw[cell.draw] = cell
  }
  return [...rows.values()]
}

export function summarizeCells(cells) {
  const draws = new Map()
  let total = 0
  for (const cell of cells) {
    const entry = draws.get(cell.draw) ?? { draw: cell.draw, count: 0, total: 0 }
    entry.count += 1
    entry.total += cell.amount
    draws.set(cell.draw, entry)
    total += cell.amount
  }
  return {
    cellCount: cells.length,
    lotCount: lotRows(cells).length,
    // Sums of dollars with two decimals: round the float noise away.
    total: Math.round(total * 100) / 100,
    draws: [...draws.values()]
      .sort((a, b) => a.draw - b.draw)
      .map((entry) => ({ ...entry, total: Math.round(entry.total * 100) / 100 })),
  }
}

// --- Display ----------------------------------------------------------------

export function describeIssue(issue) {
  const where = [
    issue.lot ? `Lot ${issue.lot}` : null,
    issue.draw ? `draw ${issue.draw}` : null,
    issue.page && !issue.lot ? `page ${issue.page}` : null,
  ].filter(Boolean).join(' · ')
  return where ? `${where}: ${issue.message}` : issue.message
}

export function visibleIssues(issues) {
  return {
    shown: issues.slice(0, ISSUE_LIMIT),
    hidden: Math.max(0, issues.length - ISSUE_LIMIT),
  }
}

/** The printed total against what the cells add up to, when the PDF prints one. */
export function describeTotals(template) {
  if (template.expectedTotal === null) {
    return { color: 'warning', text: 'The document prints no total to check the amounts against.' }
  }
  const matches = Math.round(template.expectedTotal * 100) === Math.round((template.foundTotal ?? 0) * 100)
  return matches
    ? {
        color: 'success',
        text: `The amounts add up to the printed total, ${formatMoney(template.expectedTotal)}.`,
      }
    : {
        color: 'warning',
        text: `The amounts add up to ${formatMoney(template.foundTotal)}, but the document prints ${formatMoney(template.expectedTotal)}.`,
      }
}

export function drawLabel(draw, template) {
  const info = template.draws.find((candidate) => candidate.draw === draw)
  const name = info?.name ? ` · ${info.name}` : ''
  const code = info?.costCode ? ` (${info.costCode})` : ''
  return `Draw ${draw}${name}${code}`
}

/** Short status for the document card. */
export function describePaymentScheduleDocument(template) {
  if (!template) {
    return { layoutChip: null, status: { color: 'default', label: 'No template yet' } }
  }
  const layout = LAYOUTS[template.layout]
  const layoutChip = layout ? { label: layout.label, title: layout.description } : null

  switch (template.status) {
    case 'confirmed':
      return { layoutChip, status: { color: 'success', label: 'Schedule ready' } }
    case 'needs_review':
      return { layoutChip, status: { color: 'warning', label: 'Needs review' } }
    case 'analyzing':
      return { layoutChip, status: { color: 'info', label: 'Analyzing…' } }
    case 'failed':
      return { layoutChip: null, status: { color: 'error', label: 'Analysis failed' } }
    default:
      return { layoutChip, status: null }
  }
}

export function describeTemplateStatus(template) {
  if (!template) return null
  const info = describePaymentScheduleDocument(template).status
  return info ? { color: info.color, label: info.label } : null
}
