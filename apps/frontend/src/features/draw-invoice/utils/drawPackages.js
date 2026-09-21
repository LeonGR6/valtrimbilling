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
      record.selections.forEach(({ phaseId, lotId, drawIndex }) => {
        used.set(
          drawSelectionKey(
            record.jobId,
            phaseId ?? record.phaseId,
            lotId,
            drawIndex,
          ),
          record,
        )
      })
    })

  return used
}

function sumSelectionAmounts(selections, rowForSelection, field) {
  const totalCents = selections.reduce((total, selection) => {
    const amount = rowForSelection(selection)?.[field]?.[selection.drawIndex]
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
      id: `${row.phaseId}:${row.id}:${option.id}`,
      phaseId: row.phaseId,
      phaseCode: row.phaseCode,
      building: row.building,
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

function phaseDisplayName(phase, fallbackCode) {
  const name = phase?.name ?? phase?.code ?? fallbackCode
  return name == null || name === '' ? 'Phase' : `Phase ${name}`
}

function buildPhaseSummaries(lines, phaseById) {
  const grouped = new Map()

  for (const line of lines) {
    const phaseId = line.phaseId ?? 'unknown'
    const group = grouped.get(String(phaseId)) ?? {
      phaseId,
      phaseCode: line.phaseCode ?? phaseById.get(String(phaseId))?.name ?? null,
      building: line.building ?? phaseById.get(String(phaseId))?.building ?? null,
      lotNumbers: [],
      draws: new Map(),
    }
    group.lotNumbers.push(line.lotNumber)
    const draw = group.draws.get(line.drawIndex) ?? {
      drawIndex: line.drawIndex,
      lotNumbers: [],
    }
    draw.lotNumbers.push(line.lotNumber)
    group.draws.set(line.drawIndex, draw)
    grouped.set(String(phaseId), group)
  }

  return [...grouped.values()]
    .map((group) => ({
      phaseId: group.phaseId,
      phaseCode: group.phaseCode,
      building: group.building,
      lotRange: formatLotRange(group.lotNumbers),
      draws: [...group.draws.values()]
        .sort((left, right) => left.drawIndex - right.drawIndex)
        .map((draw) => ({
          ...draw,
          lotRange: formatLotRange(draw.lotNumbers),
        })),
    }))
    .sort((left, right) => String(left.phaseCode ?? '').localeCompare(
      String(right.phaseCode ?? ''),
      'en',
      { numeric: true, sensitivity: 'base' },
    ))
}

export function summarizeDrawPackage(record, job, phaseOrPhases, schedule) {
  const phases = (Array.isArray(phaseOrPhases) ? phaseOrPhases : [phaseOrPhases])
    .filter(Boolean)
  const phaseScopes = phases.map((phase, index) => {
    const phaseId = phase.id ?? `phase-${index}`
    const worksheet = buildDrawWorksheet(job, phase, schedule)
    return {
      phase,
      phaseId,
      worksheet,
      rowsById: new Map(worksheet.rows.map((row) => [String(row.id), row])),
    }
  })
  const phaseById = new Map(
    phaseScopes.map(({ phaseId, phase }) => [String(phaseId), phase]),
  )
  const scopeByPhaseId = new Map(
    phaseScopes.map((scope) => [String(scope.phaseId), scope]),
  )
  const scopesByLotId = new Map()
  for (const scope of phaseScopes) {
    for (const row of scope.worksheet.rows) {
      const scopes = scopesByLotId.get(String(row.id)) ?? []
      scopes.push(scope)
      scopesByLotId.set(String(row.id), scopes)
    }
  }
  const scopeForSelection = (selection) => {
    if (selection.phaseId != null) {
      return scopeByPhaseId.get(String(selection.phaseId))
    }
    return scopesByLotId.get(String(selection.lotId))?.[0]
  }
  const rowForSelection = (selection) => scopeForSelection(selection)
    ?.rowsById.get(String(selection.lotId))
  const selections = record?.selections ?? []
  const selectedRows = [...new Map(selections.map((selection) => {
    const scope = scopeForSelection(selection)
    const row = rowForSelection(selection)
    if (!scope || !row) return [null, null]
    return [
      `${scope.phaseId}:${row.id}`,
      {
        ...row,
        phaseId: scope.phaseId,
        phaseCode: scope.phase.name ?? scope.phase.code ?? null,
        building: scope.phase.building ?? null,
      },
    ]
  }).filter(([key]) => key != null)).values()]
  const optionsBillingDrawIndex = getOptionsBillingDrawIndex(record, schedule)
  const optionBillingLotKeys = new Set(
    selections
      .filter(
        ({ drawIndex }) => Number(drawIndex) === optionsBillingDrawIndex,
      )
      .map((selection) => {
        const scope = scopeForSelection(selection)
        return `${scope?.phaseId ?? selection.phaseId}:${selection.lotId}`
      }),
  )
  const currentSelectedOptionRows = getSelectedOptionRows(
    selectedRows.filter((row) => (
      optionBillingLotKeys.has(`${row.phaseId}:${row.id}`)
    )),
  )
  const optionsAreDue = optionsBillingDrawIndex !== null
    && optionBillingLotKeys.size > 0

  if (record?.persistedInvoice) {
    const persistedLines = record.persistedDrawLines ?? []
    const persistedOptionLines = record.persistedOptionLines ?? []
    const selectedOptionRows = optionsAreDue
      ? persistedOptionLines
      : currentSelectedOptionRows
    const optionRows = optionsAreDue ? persistedOptionLines : []
    const optionsTotal = optionRows.reduce(
      (total, option) => addCurrencyAmounts(total, option.price),
      0,
    )
    const lotNumbers = persistedLines.map((line) => line.lotNumber)
    const phaseSummaries = buildPhaseSummaries(persistedLines, phaseById)

    return {
      worksheet: phaseScopes[0]?.worksheet ?? buildDrawWorksheet(job, null, schedule),
      worksheets: phaseScopes.map(({ phase, phaseId, worksheet }) => ({
        phase, phaseId, worksheet,
      })),
      selectedRows,
      lotCount: new Set(persistedLines.map((line) => String(line.lotId))).size,
      lotRange: phaseSummaries.length <= 1
        ? formatLotRange(lotNumbers)
        : phaseSummaries.map((scope) => (
            `${phaseDisplayName(phaseById.get(String(scope.phaseId)), scope.phaseCode)}: ${scope.lotRange}`
          )).join(' · '),
      phaseSummaries,
      phaseCount: phaseSummaries.length,
      scopeCount: persistedLines.length,
      currentDraw: record.persistedInvoice.grossAmount,
      selectedOptionRows,
      optionRows,
      optionsBillingDrawIndex,
      optionsAreDue,
      optionsTotal,
      unpricedOptionCount: 0,
      grossAmount: record.persistedInvoice.grossAmount,
      retention: record.persistedInvoice.retentionAmount,
      wrapInsurance: record.persistedInvoice.wrapAmount,
      invoiceAmount: record.persistedInvoice.netAmount,
    }
  }

  const selectedOptionRows = currentSelectedOptionRows
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
    rowForSelection,
    'drawAmounts',
  )
  const baseRetention = sumSelectionAmounts(
    selections,
    rowForSelection,
    'drawRetentionAmounts',
  )
  const baseWrapInsurance = sumSelectionAmounts(
    selections,
    rowForSelection,
    'drawWrapInsuranceAmounts',
  )
  const baseInvoiceAmount = sumSelectionAmounts(
    selections,
    rowForSelection,
    'drawInvoiceAmounts',
  )
  const optionFinancials = calculateInvoiceAmounts(optionsTotal, schedule)
  const selectedLines = selections.map((selection) => {
    const scope = scopeForSelection(selection)
    const row = rowForSelection(selection)
    if (!scope || !row) return null
    return {
      phaseId: scope.phaseId,
      phaseCode: scope.phase.name ?? scope.phase.code ?? null,
      building: scope.phase.building ?? null,
      lotId: row.id,
      lotNumber: row.lotNumber,
      drawIndex: selection.drawIndex,
    }
  }).filter(Boolean)
  const phaseSummaries = buildPhaseSummaries(selectedLines, phaseById)

  return {
    worksheet: phaseScopes[0]?.worksheet ?? buildDrawWorksheet(job, null, schedule),
    worksheets: phaseScopes.map(({ phase, phaseId, worksheet }) => ({
      phase, phaseId, worksheet,
    })),
    selectedRows,
    lotCount: selectedRows.length,
    lotRange: phaseSummaries.length <= 1
      ? formatLotRange(selectedRows.map((row) => row.lotNumber))
      : phaseSummaries.map((scope) => (
          `${phaseDisplayName(phaseById.get(String(scope.phaseId)), scope.phaseCode)}: ${scope.lotRange}`
        )).join(' · '),
    phaseSummaries,
    phaseCount: phaseSummaries.length,
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
