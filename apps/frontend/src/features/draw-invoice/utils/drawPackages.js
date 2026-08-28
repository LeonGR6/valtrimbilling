import {
  buildDrawWorksheet,
  calculateInvoiceAmounts,
  hasPlanPrice,
} from './drawWorksheet.js'

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

function addCurrencyAmounts(...amounts) {
  return amounts.reduce(
    (total, amount) => total + Math.round((Number(amount) || 0) * 100),
    0,
  ) / 100
}

function getOptionsBillingDrawIndex(record, schedule) {
  const configuredIndex = Object.prototype.hasOwnProperty.call(
    record ?? {},
    'optionsBillingDrawIndex',
  )
    ? record.optionsBillingDrawIndex
    : schedule?.optionsBillingDrawIndex

  if (configuredIndex === null || configuredIndex === undefined || configuredIndex === '') {
    return null
  }

  const parsedIndex = Number(configuredIndex)
  return Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : null
}

function getSelectedOptionRows(selectedRows) {
  return selectedRows.flatMap((row) =>
    (row.selectedOptions ?? []).map((option) => ({
      id: `${row.id}:${option.id}`,
      lotId: row.id,
      lotNumber: row.lotNumber,
      planCode: row.planCode,
      optionId: option.id,
      optionCode: option.code,
      description: option.description,
      price: option.price,
      issue: hasPlanPrice(option.price) ? null : 'PRICE_MISSING',
    })),
  )
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
  const selectedOptionRows = getSelectedOptionRows(selectedRows)
  const optionsBillingDrawIndex = getOptionsBillingDrawIndex(record, schedule)
  const optionsAreDue = optionsBillingDrawIndex !== null
    && (record?.drawIndexes ?? []).some(
      (drawIndex) => Number(drawIndex) === optionsBillingDrawIndex,
    )
  const optionRows = optionsAreDue ? selectedOptionRows : []
  const unpricedOptionCount = optionRows.filter(
    (option) => option.issue === 'PRICE_MISSING',
  ).length
  const optionsTotal = optionRows.reduce(
    (total, option) => addCurrencyAmounts(total, option.price),
    0,
  )
  const currentDraw = sumSelectionAmounts(
    selections,
    rowsById,
    'drawAmounts',
  )
  const baseRetention = sumSelectionAmounts(
    selections,
    rowsById,
    'drawRetentionAmounts',
  )
  const baseWrapInsurance = sumSelectionAmounts(
    selections,
    rowsById,
    'drawWrapInsuranceAmounts',
  )
  const baseInvoiceAmount = sumSelectionAmounts(
    selections,
    rowsById,
    'drawInvoiceAmounts',
  )
  const optionFinancials = calculateInvoiceAmounts(optionsTotal, schedule)

  return {
    worksheet,
    selectedRows,
    lotCount: selectedRows.length,
    lotRange: formatLotRange(selectedRows.map((row) => row.lotNumber)),
    scopeCount: selections.length,
    currentDraw,
    selectedOptionRows,
    optionRows,
    optionsBillingDrawIndex,
    optionsAreDue,
    optionsTotal,
    unpricedOptionCount,
    grossAmount: addCurrencyAmounts(currentDraw, optionsTotal),
    retention: addCurrencyAmounts(baseRetention, optionFinancials.retention),
    wrapInsurance: addCurrencyAmounts(
      baseWrapInsurance,
      optionFinancials.wrapInsurance,
    ),
    invoiceAmount: addCurrencyAmounts(
      baseInvoiceAmount,
      optionFinancials.invoiceAmount,
    ),
  }
}
