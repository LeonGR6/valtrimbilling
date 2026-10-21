// Pure helpers for Purchase Order (options) analysis: the persisted record model,
// the comparison with the system's options and how it is described on screen.
// Nothing here touches the network or React.

// What each comparison status means for the reviewer. `severity` orders them, the
// most urgent first. Every status only informs: nothing blocks a Package.
export const COMPARISON_STATUSES = {
  HEADER_UNRESOLVED: {
    label: 'Lot not found',
    color: 'error',
    severity: 6,
    hint: 'The Lot printed in the PDF could not be matched with a Lot of this Job.',
  },
  PLAN_MISMATCH: {
    label: 'Plan differs',
    color: 'error',
    severity: 5,
    hint: 'The Lot exists, but its Plan is not the Plan printed in the PDF.',
  },
  MISSING_OPTION: {
    label: 'Not in the system',
    color: 'error',
    severity: 4,
    hint: 'The Plan of this Lot has no option with this code.',
  },
  AMBIGUOUS_OPTION: {
    label: 'Several options',
    color: 'warning',
    severity: 3,
    hint: 'The Plan has more than one option with this code and the description does not tell which one.',
  },
  NOT_IN_LOT: {
    label: 'Not in this Lot',
    color: 'warning',
    severity: 2,
    hint: 'The option exists in the Plan, but this Lot does not have it selected.',
  },
  PRICE_DIFF: {
    label: 'Price differs',
    color: 'warning',
    severity: 1,
    hint: 'The price in the PDF is not the price this Lot bills.',
  },
  MATCH: {
    label: 'Matches',
    color: 'success',
    severity: 0,
    hint: 'The option is in the Lot and its price agrees with the PDF.',
  },
}

export const HEADER_STATUSES = {
  resolved: { label: 'Matched', color: 'success' },
  suggested: { label: 'Check match', color: 'warning' },
  ambiguous: { label: 'More than one Lot fits', color: 'error' },
  plan_mismatch: { label: 'Plan differs', color: 'error' },
  lot_not_found: { label: 'Lot not found', color: 'error' },
  phase_not_found: { label: 'Phase not found', color: 'error' },
}

const ISSUE_LIMIT = 8

function toNumber(value) {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function toPurchaseOrderAnalysis(row) {
  return {
    id: row.id,
    documentId: row.job_document_id,
    jobId: row.job_id,
    parser: row.parser ?? null,
    pageCount: row.page_count ?? 0,
    issues: Array.isArray(row.issues) ? row.issues.slice(0, ISSUE_LIMIT) : [],
    issueCount: Array.isArray(row.issues) ? row.issues.length : 0,
    status: row.status,
    error: row.error ?? null,
    analyzedAt: row.analyzed_at ?? null,
    updatedAt: row.updated_at,
  }
}

/** One line of compare_purchase_orders, with numbers as numbers. */
export function toComparisonLine(row) {
  return {
    lineId: Number(row.line_id),
    documentId: row.job_document_id,
    workOrderNo: row.work_order_no,
    referenceNo: row.reference_no,
    poDate: row.po_date ?? null,
    revisedOn: row.revised_on ?? null,
    lotRaw: row.lot_raw ?? null,
    phaseRaw: row.phase_raw ?? null,
    planRaw: row.plan_raw ?? null,
    elevationRaw: row.elevation_raw ?? null,
    optionCode: row.option_code_raw,
    descriptionLines: Array.isArray(row.description_lines) ? row.description_lines : [],
    quantity: toNumber(row.quantity) ?? 1,
    poUnitPrice: toNumber(row.po_unit_price),
    headerStatus: row.header_status,
    lotId: row.lot_id === null || row.lot_id === undefined ? null : Number(row.lot_id),
    lotNumber: row.lot_number ?? null,
    phaseCode: row.phase_code ?? null,
    building: row.building ?? null,
    planCode: row.plan_code ?? null,
    planOptionId: row.plan_option_id === null || row.plan_option_id === undefined
      ? null
      : Number(row.plan_option_id),
    optionName: row.option_name ?? null,
    systemPrice: toNumber(row.system_price),
    systemNotApplicable: row.system_not_applicable === true,
    conflictingPoPrices: row.conflicting_po_prices === true,
    status: row.status,
  }
}

export function toUncoveredOption(row) {
  return {
    lotId: Number(row.lot_id),
    lotNumber: row.lot_number,
    phaseCode: row.phase_code,
    building: row.building ?? null,
    optionId: Number(row.option_id),
    optionCode: row.option_code,
    optionName: row.option_name,
    systemPrice: toNumber(row.system_price),
    systemNotApplicable: row.system_not_applicable === true,
  }
}

/** Cents-safe difference PO - system, or null when either price is missing. */
export function priceDifference(line) {
  if (line.poUnitPrice === null || line.systemPrice === null) return null
  return Math.round((line.poUnitPrice - line.systemPrice) * 100) / 100
}

/** Counts by status, and how many lines need a look. */
export function summarizeComparison(lines) {
  const byStatus = Object.fromEntries(Object.keys(COMPARISON_STATUSES).map((key) => [key, 0]))
  for (const line of lines) {
    if (line.status in byStatus) byStatus[line.status] += 1
  }
  return {
    total: lines.length,
    byStatus,
    matches: byStatus.MATCH,
    attention: lines.length - byStatus.MATCH,
  }
}

/** The summary of each document, from the comparison of a whole Job. */
export function summarizeByDocument(lines) {
  const grouped = new Map()
  for (const line of lines) {
    const list = grouped.get(line.documentId) ?? []
    list.push(line)
    grouped.set(line.documentId, list)
  }
  return Object.fromEntries(
    [...grouped].map(([documentId, documentLines]) => [documentId, summarizeComparison(documentLines)]),
  )
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

/** What the card of a Purchase Order PDF shows: a status chip and what was found. */
export function describePurchaseOrderDocument(analysis, summary = null, analyzing = false) {
  if (analyzing || analysis?.status === 'analyzing') {
    return { status: { color: 'info', label: 'Analyzing…' }, linesChip: null }
  }
  if (!analysis) {
    return { status: { color: 'default', label: 'Not analyzed' }, linesChip: null }
  }

  switch (analysis.status) {
    case 'failed':
      return { status: { color: 'error', label: 'Analysis failed' }, linesChip: null }
    case 'not_option_po':
      return {
        status: { color: 'default', label: 'Not a PO of options' },
        linesChip: null,
        title: analysis.error ?? 'This PDF is not a Purchase Order of options.',
      }
    case 'analyzed': {
      const linesChip = summary ? { label: plural(summary.total, 'option', 'options') } : null
      if (!summary) return { status: { color: 'info', label: 'Analyzed' }, linesChip }
      if (summary.attention > 0) {
        return {
          status: { color: 'warning', label: `${summary.attention} to review` },
          linesChip,
        }
      }
      return { status: { color: 'success', label: 'All match' }, linesChip }
    }
    default:
      return { status: null, linesChip: null }
  }
}

function printedPlan(line) {
  if (!line.planRaw) return null
  return `${line.planRaw}${line.elevationRaw ?? ''}`
}

/**
 * The lines of a document grouped by work order, each with how its header was
 * matched. Most urgent work orders come first inside the same Lot order.
 */
export function groupWorkOrders(lines) {
  const groups = new Map()
  for (const line of lines) {
    const key = `${line.documentId}|${line.workOrderNo}`
    const group = groups.get(key) ?? {
      key,
      workOrderNo: line.workOrderNo,
      headerStatus: line.headerStatus,
      printed: {
        lot: line.lotRaw,
        phase: line.phaseRaw,
        plan: printedPlan(line),
      },
      system: line.lotId === null
        ? null
        : {
          lotId: line.lotId,
          lotNumber: line.lotNumber,
          phaseCode: line.phaseCode,
          building: line.building,
          planCode: line.planCode,
        },
      lines: [],
    }
    group.lines.push(line)
    groups.set(key, group)
  }

  return [...groups.values()].sort((left, right) => {
    const a = left.system?.lotNumber ?? left.printed.lot ?? ''
    const b = right.system?.lotNumber ?? right.printed.lot ?? ''
    return a.localeCompare(b, 'en', { numeric: true }) || left.workOrderNo.localeCompare(right.workOrderNo)
  })
}

/** A sentence for the reviewer about how the header of a work order was matched. */
export function describeHeaderMatch(group) {
  const { printed, system } = group
  const printedText = [
    printed.lot ? `Lot ${printed.lot}` : null,
    printed.phase ? `Phase ${printed.phase}` : null,
    printed.plan ? `Plan ${printed.plan}` : null,
  ].filter(Boolean).join(' · ')

  switch (group.headerStatus) {
    case 'resolved':
      return null
    case 'suggested':
      return `The PDF says ${printedText}. It was matched with Lot ${system?.lotNumber}, Phase ${system?.phaseCode}, Plan ${system?.planCode}. Confirm it so the next PDFs match without asking.`
    case 'plan_mismatch':
      return `The PDF says Plan ${printed.plan}, but Lot ${system?.lotNumber} is Plan ${system?.planCode} in the system. Its options are compared with that Plan.`
    case 'ambiguous':
      return `More than one Lot of this Job fits ${printedText}.`
    case 'phase_not_found':
      return `No Phase of this Job fits ${printed.phase ?? 'the one in the PDF'}.`
    case 'lot_not_found':
      return `No Lot of this Job fits ${printedText}. Add the Lot to the Job, then match again.`
    default:
      return null
  }
}

/** Uncovered options of the Lots a document is about, grouped by Lot. */
export function uncoveredByLot(uncovered, lotIds) {
  const wanted = new Set(lotIds)
  const lots = new Map()
  for (const option of uncovered) {
    if (!wanted.has(option.lotId)) continue
    const entry = lots.get(option.lotId) ?? {
      lotId: option.lotId,
      lotNumber: option.lotNumber,
      options: [],
    }
    entry.options.push(option)
    lots.set(option.lotId, entry)
  }
  return [...lots.values()].sort((a, b) =>
    a.lotNumber.localeCompare(b.lotNumber, 'en', { numeric: true }))
}
