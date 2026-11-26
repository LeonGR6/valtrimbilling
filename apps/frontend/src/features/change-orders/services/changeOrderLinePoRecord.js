// Which builder Purchase Order backs each line (each Lot) of an Extra / Change Order, as the database works
// it out (valtrim.change_order_line_po_matches) from the orders read from the Job's PO PDFs.

import { PO_KIND_LABELS } from './changeOrderPoFileRecord.js'

export const LINE_PO_COLUMNS = [
  'change_order_id',
  'change_order_number',
  'change_order_status',
  'line_id',
  'lot_number',
  'line_amount',
  'po_id',
  'po_line_number',
  'file_id',
  'file_name',
  'storage_bucket',
  'storage_path',
  'po_number',
  'document_kind',
  'issued_date',
  'lot_text',
  'lots_checked',
  'po_line_description',
  'lot_amount',
  'lot_net_amount',
  'number_matches',
  'amount_matches',
  'match_level',
  'is_best',
].join(', ')

/** How sure a match is, surest first. */
export const MATCH_LEVELS = {
  NUMBER: { rank: 3, color: 'success', label: 'PO / CO # matches' },
  AMOUNT: { rank: 2, color: 'success', label: 'Lot and amount match' },
  LOT: { rank: 1, color: 'warning', label: 'Only the Lot matches: check the amount' },
}

const money = (value) => (value === null || value === undefined ? null : Number(value))

export function toLinePo(row) {
  return {
    changeOrderId: row.change_order_id,
    changeOrderNumber: row.change_order_number ?? '',
    changeOrderStatus: row.change_order_status ?? '',
    lineId: row.line_id,
    lot: row.lot_number ?? '',
    lineAmount: money(row.line_amount),
    poId: row.po_id,
    poLineNumber: row.po_line_number,
    file: {
      id: row.file_id,
      name: row.file_name ?? '',
      bucket: row.storage_bucket,
      storagePath: row.storage_path,
    },
    number: row.po_number ?? '',
    kind: row.document_kind,
    kindLabel: PO_KIND_LABELS[row.document_kind] ?? 'Order',
    issuedDate: row.issued_date ?? null,
    lotText: row.lot_text ?? '',
    lotChecked: Boolean(row.lots_checked),
    description: row.po_line_description ?? '',
    lotAmount: money(row.lot_amount),
    lotNetAmount: money(row.lot_net_amount),
    numberMatches: Boolean(row.number_matches),
    amountMatches: row.amount_matches ?? null,
    level: MATCH_LEVELS[row.match_level] ? row.match_level : 'LOT',
    isBest: Boolean(row.is_best),
  }
}

/** The surest POs of each line: `{ [lineId]: match[] }`. A line with no PO is not in it. */
export function bestPosByLine(matches = []) {
  const byLine = {}
  for (const match of matches) {
    if (!match.isBest) continue
    const key = String(match.lineId)
    if (!byLine[key]) byLine[key] = []
    if (!byLine[key].some((other) => other.poId === match.poId)) byLine[key].push(match)
  }
  return byLine
}

const lotSort = (left, right) => String(left).localeCompare(String(right), undefined, { numeric: true })

/** The level of a group: the least sure of its matches. */
const weakest = (levels) => levels.reduce(
  (worst, level) => (MATCH_LEVELS[level].rank < MATCH_LEVELS[worst].rank ? level : worst),
  'NUMBER',
)

/**
 * How the lines of an Extra / CO stand: how many have a PO, which do not, and each PO with the Lots it
 * backs. `{ total, backed, missing: line[], pos: [{ poId, number, kindLabel, file, lots, level }] }`.
 */
export function summarizeLinePos(lines = [], byLine = {}) {
  const pos = new Map()
  const missing = []
  for (const line of lines) {
    const matches = byLine[String(line.id)] ?? []
    if (matches.length === 0) {
      missing.push(line)
      continue
    }
    for (const match of matches) {
      const entry = pos.get(match.poId) ?? {
        poId: match.poId,
        number: match.number,
        kindLabel: match.kindLabel,
        issuedDate: match.issuedDate,
        file: match.file,
        lots: [],
        places: 0,
        levels: [],
      }
      if (line.lot) entry.lots.push(String(line.lot))
      else entry.places += 1
      entry.levels.push(match.level)
      pos.set(match.poId, entry)
    }
  }
  return {
    total: lines.length,
    backed: lines.length - missing.length,
    missing,
    pos: [...pos.values()]
      .map(({ levels, ...entry }) => ({ ...entry, lots: entry.lots.sort(lotSort), level: weakest(levels) }))
      .sort((left, right) => lotSort(left.number, right.number)),
  }
}

/**
 * The Extras / COs each read order backs (a cancelled one is left out), for the Documents tab:
 * `{ [poId]: [{ changeOrderId, number, lots, level }] }`.
 */
export function changeOrdersByPo(matches = []) {
  const byPo = {}
  for (const match of matches) {
    if (!match.isBest || match.changeOrderStatus === 'CANCELLED') continue
    const key = String(match.poId)
    if (!byPo[key]) byPo[key] = []
    let entry = byPo[key].find((item) => item.changeOrderId === match.changeOrderId)
    if (!entry) {
      entry = { changeOrderId: match.changeOrderId, number: match.changeOrderNumber, lots: [], levels: [] }
      byPo[key].push(entry)
    }
    if (match.lot && !entry.lots.includes(match.lot)) entry.lots.push(match.lot)
    entry.levels.push(match.level)
  }
  for (const key of Object.keys(byPo)) {
    byPo[key] = byPo[key]
      .map(({ levels, ...entry }) => ({ ...entry, lots: entry.lots.sort(lotSort), level: weakest(levels) }))
      .sort((left, right) => lotSort(left.number, right.number))
  }
  return byPo
}

/** "Lot 17 · $1,689.60 on the PO" with what agrees, for the card of a match. */
export function describeMatch(match, formatCurrency) {
  const amount = match.lotAmount === null ? null : formatCurrency(match.lotAmount)
  const net = match.lotNetAmount === null ? null : formatCurrency(match.lotNetAmount)
  const facts = []
  if (match.numberMatches) facts.push('The PO number is the PO / CO # of this Extra / CO.')
  if (match.amountMatches === 'GROSS') facts.push('The amount of the Lot is the same.')
  else if (match.amountMatches === 'NET') facts.push('The amount of the Lot is the same once OCIP is taken out.')
  else if (match.lotAmount !== null) facts.push('The amount of the Lot is not the same.')
  if (!match.lotChecked && match.lotText) facts.push('The Lot was not found printed in the PDF.')
  return { amount, net, facts }
}
