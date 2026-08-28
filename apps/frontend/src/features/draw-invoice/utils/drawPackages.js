import { buildDrawWorksheet } from './drawWorksheet.js'

export function drawSelectionKey(jobId, phaseId, lotId, drawIndex) {
  return `${jobId}:${phaseId}:${lotId}:${drawIndex}`
}

export function makePackageSelections(lotIds = [], drawIndexes = []) {
  return lotIds.flatMap((lotId) =>
    drawIndexes.map((drawIndex) => ({ lotId, drawIndex })),
  )
}

export function formatLotRange(lotNumbers = []) {
  const sortedLots = [...new Set(
    lotNumbers.map((value) => String(value).trim()).filter(Boolean),
  )].sort((left, right) =>
    left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }),
  )

  if (sortedLots.length === 0) return '—'

  const ranges = []
  let rangeStart = sortedLots[0]
  let rangeEnd = sortedLots[0]

  const appendRange = () => {
    ranges.push(rangeStart === rangeEnd ? rangeStart : `${rangeStart}–${rangeEnd}`)
  }

  for (const lotNumber of sortedLots.slice(1)) {
    const previousIsNumeric = /^\d+$/.test(rangeEnd)
    const currentIsNumeric = /^\d+$/.test(lotNumber)
    const isConsecutive =
      previousIsNumeric &&
      currentIsNumeric &&
      Number(lotNumber) === Number(rangeEnd) + 1

    if (isConsecutive) {
      rangeEnd = lotNumber
    } else {
      appendRange()
      rangeStart = lotNumber
      rangeEnd = lotNumber
    }
  }

  appendRange()
  return ranges.join(', ')
}

export function buildUsedDrawSelections(packages = [], excludedPackageId = null) {
  const used = new Map()

  packages
    .filter((record) => record.id !== excludedPackageId)
    .forEach((record) => {
      record.selections.forEach(({ lotId, drawIndex }) => {
        used.set(
          drawSelectionKey(record.jobId, record.phaseId, lotId, drawIndex),
          record,
        )
      })
    })

  return used
}

function sumSelectionAmounts(selections, rowsById, field) {
  const totalCents = selections.reduce((total, { lotId, drawIndex }) => {
    const amount = rowsById.get(String(lotId))?.[field]?.[drawIndex]
    return total + (Number.isFinite(amount) ? Math.round(amount * 100) : 0)
  }, 0)

  return totalCents / 100
}

export function summarizeDrawPackage(record, job, phase, schedule) {
  const worksheet = buildDrawWorksheet(job, phase, schedule)
  const rowsById = new Map(
    worksheet.rows.map((row) => [String(row.id), row]),
  )
  const selections = record?.selections ?? []
  const selectedRows = (record?.lotIds ?? [])
    .map((lotId) => rowsById.get(String(lotId)))
    .filter(Boolean)

  return {
    worksheet,
    selectedRows,
    lotCount: selectedRows.length,
    lotRange: formatLotRange(selectedRows.map((row) => row.lotNumber)),
    scopeCount: selections.length,
    currentDraw: sumSelectionAmounts(
      selections,
      rowsById,
      'drawAmounts',
    ),
    retention: sumSelectionAmounts(
      selections,
      rowsById,
      'drawRetentionAmounts',
    ),
    wrapInsurance: sumSelectionAmounts(
      selections,
      rowsById,
      'drawWrapInsuranceAmounts',
    ),
    invoiceAmount: sumSelectionAmounts(
      selections,
      rowsById,
      'drawInvoiceAmounts',
    ),
  }
}
