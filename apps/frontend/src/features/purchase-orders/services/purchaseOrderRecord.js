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

// --- Importing options -------------------------------------------------------

// Why a line was not imported, in words for the reviewer. Must match the reasons
// of valtrim.import_purchase_order_options.
export const IMPORT_SKIP_REASONS = {
  header_not_confirmed: 'Confirm the Lot match first.',
  not_importable: 'Already in the system.',
  not_current: 'A newer Purchase Order replaced this line.',
  utility_lot: 'Utility buildings have no options.',
  inactive: 'The Job, Phase or Plan is inactive.',
  phase_billed: 'A Package already billed this Phase.',
  no_price: 'The option has no price.',
}

/**
 * What importing a line would do: create the option in the Plan and select it for
 * the Lot, or only select it for the Lot. Null when there is nothing to import, or
 * the Lot was only suggested and has to be confirmed first.
 */
export function importAction(line) {
  if (line.headerStatus !== 'resolved') return null
  if (line.status === 'MISSING_OPTION') return 'create'
  if (line.status === 'NOT_IN_LOT') return 'add'
  return null
}

export function describeImportAction(line) {
  const lot = `Lot ${line.lotNumber}`
  switch (importAction(line)) {
    case 'create': return `Create the option in Plan ${line.planCode} and add it to ${lot}`
    case 'add': return `Add it to ${lot}`
    default: return null
  }
}

function optionKey(line) {
  return `${line.planCode}|${String(line.optionCode).toUpperCase().replace(/[^A-Z0-9]/g, '')}`
}

/** What a set of lines would do: new options in Plans and options added to Lots. */
export function summarizeImport(lines) {
  const importable = lines.filter((line) => importAction(line) !== null)
  const created = new Set(
    importable.filter((line) => importAction(line) === 'create').map(optionKey),
  )
  return { newOptions: created.size, additions: importable.length }
}

export function toImportResult(data) {
  const skipped = Array.isArray(data?.skipped) ? data.skipped : []
  return {
    createdOptions: Number(data?.created_options ?? 0),
    addedToLots: Number(data?.added_to_lots ?? 0),
    skipped: skipped.map((item) => ({
      lineId: Number(item.line_id),
      reason: item.reason,
      message: IMPORT_SKIP_REASONS[item.reason] ?? 'It could not be imported.',
    })),
  }
}

function count(number, one, many) {
  return `${number} ${number === 1 ? one : many}`
}

/** One sentence for what an import did, and how serious the skipped lines are. */
export function describeImportResult(result) {
  const done = result.addedToLots > 0 || result.createdOptions > 0
  const parts = []
  if (result.createdOptions > 0) parts.push(`created ${count(result.createdOptions, 'option', 'options')}`)
  if (result.addedToLots > 0) parts.push(`added ${count(result.addedToLots, 'option', 'options')} to Lots`)
  const skipped = result.skipped.length > 0
    ? ` ${count(result.skipped.length, 'line was', 'lines were')} skipped.`
    : ''

  if (!done) {
    return {
      severity: 'warning',
      message: `Nothing was imported.${skipped}`.trim(),
    }
  }
  const text = parts.join(' and ')
  return {
    severity: result.skipped.length > 0 ? 'warning' : 'success',
    message: `${text.charAt(0).toUpperCase()}${text.slice(1)}.${skipped}`,
  }
}

// --- Adopting the PDF's price --------------------------------------------------

/** True when the user can offer the PDF's price for a line: a settled price difference. */
export function canUsePdfPrice(line) {
  return line.status === 'PRICE_DIFF' && line.headerStatus === 'resolved' && line.planOptionId !== null
}

/**
 * The lines that can take the same price together: an option has one price per
 * Plan, so every line of that option that prints the same price is offered. The
 * clicked line is always included.
 */
export function priceCandidates(line, lines) {
  const same = lines.filter((candidate) => (
    candidate.lineId !== line.lineId
    && canUsePdfPrice(candidate)
    && candidate.planOptionId === line.planOptionId
    && candidate.poUnitPrice === line.poUnitPrice
  ))
  return [line, ...same].sort((a, b) =>
    String(a.lotNumber).localeCompare(String(b.lotNumber), 'en', { numeric: true }))
}

export const PRICE_SKIP_REASONS = {
  not_price_difference: 'It already matches.',
  header_not_confirmed: 'Confirm the Lot match first.',
  inactive: 'The Phase is inactive.',
  not_current: 'A newer Purchase Order replaced this line.',
}

export function toPriceResult(data) {
  const skipped = Array.isArray(data?.skipped) ? data.skipped : []
  return {
    priceSet: data?.price_set === true,
    optionId: data?.option_id == null ? null : Number(data.option_id),
    price: data?.price == null ? null : Number(data.price),
    lots: Number(data?.options ?? 0),
    packages: Array.isArray(data?.packages) ? data.packages : [],
    differences: Array.isArray(data?.differences) ? data.differences : [],
    removedStoragePaths: Array.isArray(data?.removed_storage_paths) ? data.removed_storage_paths : [],
    skipped: skipped.map((item) => ({
      lineId: Number(item.line_id),
      reason: item.reason,
      message: PRICE_SKIP_REASONS[item.reason] ?? 'It could not be changed.',
    })),
  }
}

/** What adopting a price did, in sentences for the reviewer. */
export function describePriceResult(result, { optionCode, planCode, formatMoney }) {
  if (result.lots === 0) {
    return { severity: 'warning', message: 'No Lot changed price.' }
  }

  const recalculated = result.packages.map((item) => item.package_number).filter(Boolean)
  const regenerate = result.packages
    .filter((item) => Number(item.documents_removed) > 0)
    .map((item) => item.package_number)
  const owed = result.differences.map((item) => item.package_number).filter(Boolean)

  return {
    severity: result.skipped.length > 0 ? 'warning' : 'success',
    message: [
      result.priceSet
        ? `${optionCode} now costs ${formatMoney(result.price)} in Plan ${planCode}.`
        : `${optionCode} already cost ${formatMoney(result.price)} in Plan ${planCode}.`,
      `${result.lots} ${result.lots === 1 ? 'Lot bills' : 'Lots bill'} that price.`,
      recalculated.length > 0 ? `Recalculated ${recalculated.join(', ')}.` : null,
      regenerate.length > 0
        ? `Generate the Release and Payment Schedule again for ${regenerate.join(', ')}.`
        : null,
      owed.length > 0
        ? `${owed.join(', ')} keep their amount; the difference is pending to collect.`
        : null,
      result.skipped.length > 0
        ? `${result.skipped.length} ${result.skipped.length === 1 ? 'line was' : 'lines were'} skipped.`
        : null,
    ].filter(Boolean).join(' '),
  }
}

// --- Backing in Packages -------------------------------------------------------
//
// When a Package bills an option, does a Purchase Order back it? Only informs: it
// never blocks a Package. The price compared is the one the Package row shows (the
// Lot's price for a new Package, the snapshot for an issued one), not today's.

function optionCodeKey(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * An index of what the Job's Purchase Orders print, for looking an option of a Lot
 * up quickly. `hasPurchaseOrders` is false when the Job has none, so the screens
 * can stay quiet about a feature the Job does not use.
 */
export function buildPurchaseOrderBacking(lines) {
  const lotsWithPurchaseOrder = new Set()
  const byOptionId = new Map()
  const byCode = new Map()

  for (const line of lines) {
    if (line.lotId === null) continue
    lotsWithPurchaseOrder.add(line.lotId)
    if (line.planOptionId !== null) byOptionId.set(`${line.lotId}|${line.planOptionId}`, line)
    byCode.set(`${line.lotId}|${optionCodeKey(line.optionCode)}`, line)
  }

  return {
    hasPurchaseOrders: lotsWithPurchaseOrder.size > 0,
    /**
     * 'backed', 'price_differs', 'not_in_po' (the Lot has a Purchase Order that does
     * not print this option) or 'no_po' (the Lot has none). `poPrice` for a difference.
     */
    lookup(row) {
      const lotId = Number(row.lotId)
      const line = byOptionId.get(`${lotId}|${Number(row.optionId)}`)
        ?? byCode.get(`${lotId}|${optionCodeKey(row.optionCode)}`)
      if (!line) {
        return { state: lotsWithPurchaseOrder.has(lotId) ? 'not_in_po' : 'no_po' }
      }

      const price = row.priceNotApplicable === true ? 0 : Number(row.price)
      if (!Number.isFinite(price) || line.poUnitPrice === null) return { state: 'backed' }
      return Math.round((price - line.poUnitPrice) * 100) === 0
        ? { state: 'backed', poPrice: line.poUnitPrice }
        : { state: 'price_differs', poPrice: line.poUnitPrice }
    },
  }
}

const BACKING_LABELS = {
  backed: {
    label: 'In the PO',
    color: 'success',
    variant: 'outlined',
    hint: 'A Purchase Order prints this option at this price.',
  },
  price_differs: {
    label: 'PO price differs',
    color: 'warning',
    variant: 'filled',
    hint: 'A Purchase Order prints this option at another price.',
  },
  not_in_po: {
    label: 'Not in the PO',
    color: 'warning',
    variant: 'filled',
    hint: 'This Lot has a Purchase Order, and it does not print this option.',
  },
  no_po: {
    label: 'No PO',
    color: 'default',
    variant: 'outlined',
    hint: 'No Purchase Order has been uploaded for this Lot.',
  },
}

export function describeBacking(result) {
  return BACKING_LABELS[result.state] ?? null
}

/** How many of the rows a Purchase Order does not back (different price or missing). */
export function countUnbacked(backing, rows) {
  if (!backing?.hasPurchaseOrders) return 0
  return rows.filter((row) => {
    const { state } = backing.lookup(row)
    return state === 'price_differs' || state === 'not_in_po'
  }).length
}
