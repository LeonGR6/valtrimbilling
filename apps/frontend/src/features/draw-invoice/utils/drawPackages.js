import {
  buildDrawWorksheet,
  calculateInvoiceAmounts,
  hasPlanPrice,
} from './drawWorksheet.js'

export function drawSelectionKey(jobId, phaseId, lotId, drawIndex) {
  return `${jobId}:${phaseId}:${lotId}:${drawIndex}`
}

export function optionSelectionKey(phaseId, lotId, optionId) {
  return `${phaseId}:${lotId}:${optionId}`
}

function optionBillingIdentity(lotId, optionId) {
  return `${lotId}:${optionId}`
}

function isAtOrAfterOptionsBillingDraw(drawIndex, optionsBillingDrawIndex) {
  return optionsBillingDrawIndex !== null
    && Number(drawIndex) >= optionsBillingDrawIndex
}

const DRAW_EVENT_TYPES = new Set(['EXT', 'DM', 'HW'])

export function formatPackageScopeEventTypes(eventTypes = []) {
  const supportedEventTypes = [...new Set(
    eventTypes.filter((eventType) => DRAW_EVENT_TYPES.has(eventType)),
  )]

  return supportedEventTypes.length > 0
    ? supportedEventTypes.join(' / ')
    : '—'
}

function getPackageScopeEventTypes(record, selections, schedule) {
  const eventTypeByDrawIndex = new Map()

  for (const line of record?.persistedDrawLines ?? []) {
    if (DRAW_EVENT_TYPES.has(line.eventType)) {
      eventTypeByDrawIndex.set(Number(line.drawIndex), line.eventType)
    }
  }

  for (const selection of selections) {
    const drawIndex = Number(selection.drawIndex)
    const eventType = selection.eventType
      ?? schedule?.draws?.[drawIndex]?.eventType
    if (!eventTypeByDrawIndex.has(drawIndex) && DRAW_EVENT_TYPES.has(eventType)) {
      eventTypeByDrawIndex.set(drawIndex, eventType)
    }
  }

  return [...new Set([...eventTypeByDrawIndex.entries()]
    .sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
    .map(([, eventType]) => eventType))]
}

export function buildOptionChargeContext(
  packages = [],
  jobId,
  fallbackOptionsBillingDrawIndex = null,
) {
  const eligibleOptionLotIds = new Set()
  const billedOptionEntries = []

  for (const record of packages) {
    if (String(record.jobId) !== String(jobId) || record.status === 'CANCELLED') {
      continue
    }

    const recordBillingDrawIndex = getOptionsBillingDrawIndex(
      record,
      { optionsBillingDrawIndex: fallbackOptionsBillingDrawIndex },
    )
    if (recordBillingDrawIndex !== null) {
      for (const selection of record.selections ?? []) {
        if (isAtOrAfterOptionsBillingDraw(
          selection.drawIndex,
          recordBillingDrawIndex,
        )) {
          eligibleOptionLotIds.add(String(selection.lotId))
        }
      }
    }

    for (const option of record.persistedOptionLines ?? []) {
      billedOptionEntries.push({
        identity: optionBillingIdentity(option.lotId, option.optionId),
        lotId: option.lotId,
        optionId: option.optionId,
        packageId: record.id,
        packageNumber: record.packageNumber,
        price: option.price,
        billingDrawIndex: option.billingDrawIndex,
      })
    }
  }

  return {
    eligibleOptionLotIds: [...eligibleOptionLotIds],
    billedOptionEntries,
  }
}

function comparePackagesChronologically(left, right) {
  const leftCreatedAt = Date.parse(left.createdAt ?? '')
  const rightCreatedAt = Date.parse(right.createdAt ?? '')

  if (
    Number.isFinite(leftCreatedAt)
    && Number.isFinite(rightCreatedAt)
    && leftCreatedAt !== rightCreatedAt
  ) {
    return leftCreatedAt - rightCreatedAt
  }

  const leftId = Number(left.id)
  const rightId = Number(right.id)
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return leftId - rightId
  }

  return String(left.packageNumber ?? '').localeCompare(
    String(right.packageNumber ?? ''),
    'en',
    { numeric: true, sensitivity: 'base' },
  )
}

export function buildPackageOptionHistory(packages = [], currentPackage) {
  if (currentPackage == null) return []

  const orderedPackages = packages
    .filter((record) => String(record.jobId) === String(currentPackage.jobId))
    .sort(comparePackagesChronologically)
  const currentIndex = orderedPackages.findIndex(
    (record) => String(record.id) === String(currentPackage.id),
  )

  if (currentIndex < 0) return []

  return orderedPackages
    .slice(0, currentIndex + 1)
    .filter((record) => record.status !== 'CANCELLED')
    .flatMap((record) => (record.persistedOptionLines ?? []).map((option) => ({
      ...option,
      chargedPackageId: record.id,
      chargedPackageNumber: record.packageNumber,
      chargedInCurrentPackage: String(record.id) === String(currentPackage.id),
    })))
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
      id: optionSelectionKey(row.phaseId, row.id, option.id),
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
  const scopeEventTypes = getPackageScopeEventTypes(record, selections, schedule)
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
        ({ drawIndex }) => isAtOrAfterOptionsBillingDraw(
          drawIndex,
          optionsBillingDrawIndex,
        ),
      )
      .map((selection) => {
        const scope = scopeForSelection(selection)
        return `${scope?.phaseId ?? selection.phaseId}:${selection.lotId}`
      }),
  )
  const optionChargeDrawIndexes = selections
    .map(({ drawIndex }) => Number(drawIndex))
    .filter((drawIndex) => isAtOrAfterOptionsBillingDraw(
      drawIndex,
      optionsBillingDrawIndex,
    ))
  const optionChargeDrawIndex = optionChargeDrawIndexes.length === 0
    ? null
    : Math.min(...optionChargeDrawIndexes)
  const eligibleOptionLotIds = new Set(
    (record?.eligibleOptionLotIds ?? []).map(String),
  )
  for (const selection of selections) {
    if (isAtOrAfterOptionsBillingDraw(
      selection.drawIndex,
      optionsBillingDrawIndex,
    )) {
      eligibleOptionLotIds.add(String(selection.lotId))
    }
  }
  const billedOptionsByIdentity = new Map(
    (record?.billedOptionEntries ?? []).map((option) => [
      option.identity ?? optionBillingIdentity(option.lotId, option.optionId),
      option,
    ]),
  )
  const availableDraftOptionRows = getSelectedOptionRows(
    phaseScopes.flatMap((scope) => scope.worksheet.rows
      .filter((row) => eligibleOptionLotIds.has(String(row.id)))
      .map((row) => ({
        ...row,
        phaseId: scope.phaseId,
        phaseCode: scope.phase.name ?? scope.phase.code ?? null,
        building: scope.phase.building ?? null,
      }))),
  ).map((option) => {
    const billed = billedOptionsByIdentity.get(
      optionBillingIdentity(option.lotId, option.optionId),
    )
    return billed == null ? option : {
      ...option,
      isBilled: true,
      billedPackageId: billed.packageId,
      billedPackageNumber: billed.packageNumber,
      billedPrice: billed.price,
      billingDrawIndex: billed.billingDrawIndex,
    }
  })
  const excludedOptionKeys = new Set(record?.excludedOptionKeys ?? [])
  const selectedDraftOptionRows = availableDraftOptionRows.filter(
    (option) => !option.isBilled && !excludedOptionKeys.has(option.id),
  )
  const optionsAreDue = optionsBillingDrawIndex !== null
    && optionBillingLotKeys.size > 0

  if (record?.persistedInvoice) {
    const persistedLines = record.persistedDrawLines ?? []
    const persistedOptionLines = record.persistedOptionLines ?? []
    const chargedOptionRows = record.chargedOptionRows
      ?? persistedOptionLines.map((option) => ({
        ...option,
        chargedPackageId: record.id,
        chargedPackageNumber: record.packageNumber,
        chargedInCurrentPackage: true,
      }))
    const selectedOptionRows = optionsAreDue
      ? persistedOptionLines
      : availableDraftOptionRows
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
      scopeEventTypes,
      currentDraw: record.persistedInvoice.grossAmount,
      availableOptionRows: persistedOptionLines,
      selectedOptionRows,
      chargedOptionRows,
      optionRows,
      billedOptionCount: 0,
      optionsBillingDrawIndex,
      optionChargeDrawIndex: persistedOptionLines[0]?.billingDrawIndex
        ?? optionChargeDrawIndex,
      optionsAreDue,
      optionsTotal,
      unpricedOptionCount: 0,
      grossAmount: record.persistedInvoice.grossAmount,
      retention: record.persistedInvoice.retentionAmount,
      wrapInsurance: record.persistedInvoice.wrapAmount,
      invoiceAmount: record.persistedInvoice.netAmount,
    }
  }

  const selectedOptionRows = selectedDraftOptionRows
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
    scopeEventTypes,
    currentDraw,
    availableOptionRows: availableDraftOptionRows,
    selectedOptionRows,
    optionRows,
    billedOptionCount: availableDraftOptionRows.filter(
      (option) => option.isBilled,
    ).length,
    optionsBillingDrawIndex,
    optionChargeDrawIndex,
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
