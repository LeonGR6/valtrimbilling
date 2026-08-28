import { buildDrawWorksheet } from './drawWorksheet.js'

export function drawSelectionKey(jobId, phaseId, lotId, drawIndex) {
  return `${jobId}:${phaseId}:${lotId}:${drawIndex}`
}

export function makePackageSelections(lotIds = [], drawIndexes = []) {
  return lotIds.flatMap((lotId) =>
    drawIndexes.map((drawIndex) => ({ lotId, drawIndex })),
  )
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
