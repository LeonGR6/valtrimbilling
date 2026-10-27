import {
  buildDrawWorksheet,
  calculateInvoiceAmounts,
  getHardwareBillingMode,
  getHardwareEventPercentage,
  getUtilityBillingMode,
  getUtilityEventPercentage,
  hasOptionPrice,
} from './drawWorksheet.js'

export function drawSelectionKey(jobId, phaseId, lotId, drawIndex) {
  return `${jobId}:${phaseId}:${lotId}:${drawIndex}`
}

export function hardwareSelectionKey(phaseId, lotId, drawIndex) {
  return `${phaseId}:${lotId}:${drawIndex}`
}

export function hardwareEventSelectionKey(phaseId, lotId, eventType) {
  return `${phaseId}:${lotId}:${eventType}`
}

export function hardwareChargeKey(lotId, billingMode, eventType = null) {
  return billingMode === 'BY_EVENT' && eventType
    ? `${lotId}:${eventType}`
    : `${lotId}:FULL`
}

export function utilityChargeKey(lotId, billingMode, eventType = null) {
  return billingMode === 'BY_EVENT' && eventType
    ? `${lotId}:${eventType}`
    : `${lotId}:FULL`
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
const EVENT_TYPE_ORDER_INDEX = { EXT: 100, DM: 101, HW: 102 }

/**
 * What a Retention Release gives back, in what a person bills: the Lots whose retention it
 * releases (draw and Hardware lines) and the Options that were billed in those same lines.
 * `packages` are the Job's Packages, where the Options of the source Packages are read.
 */
export function summarizeRetentionSource(retentionRelease, packages = []) {
  const drawLines = retentionRelease?.sourceLines ?? []
  const hardwareLines = retentionRelease?.sourceHardwareLines ?? []
  const lotIds = new Set([
    ...drawLines.map((line) => String(line.sourceLotId)),
    ...hardwareLines.map((line) => String(line.sourceLotId)),
  ])
  const sourceDraws = new Set(drawLines.map((line) => (
    `${line.sourcePackageId}:${line.sourceLotId}:${line.sourceDrawId}`
  )))
  const sourcePackageIds = new Set(drawLines.map((line) => String(line.sourcePackageId)))
  const options = new Set()

  for (const record of packages) {
    if (!sourcePackageIds.has(String(record.id))) continue
    for (const option of record.persistedOptionLines ?? []) {
      const billingLotId = option.billingLotId ?? option.lotId
      if (sourceDraws.has(`${record.id}:${billingLotId}:${option.drawId}`)) {
        options.add(`${option.lotId}:${option.optionId}`)
      }
    }
  }

  return { lotCount: lotIds.size, optionCount: options.size }
}

/** "28 Lots · 3 Options": the one-line version of summarizeRetentionSource. */
export function describeRetentionSource({ lotCount, optionCount }) {
  return [
    `${lotCount} ${lotCount === 1 ? 'Lot' : 'Lots'}`,
    `${optionCount} ${optionCount === 1 ? 'Option' : 'Options'}`,
  ].join(' · ')
}

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

  for (const line of record?.persistedHardwareLines ?? []) {
    if (DRAW_EVENT_TYPES.has(line.hardwareEventType)) {
      eventTypeByDrawIndex.set(
        EVENT_TYPE_ORDER_INDEX[line.hardwareEventType],
        line.hardwareEventType,
      )
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

  for (const selection of record?.hardwareSelections ?? []) {
    if (
      selection.chargeHardware !== false
      && DRAW_EVENT_TYPES.has(selection.eventType)
    ) {
      eventTypeByDrawIndex.set(
        EVENT_TYPE_ORDER_INDEX[selection.eventType],
        selection.eventType,
      )
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
        priceNotApplicable: option.priceNotApplicable === true,
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
    .filter((record) => (
      record.id !== excludedPackageId && record.status !== 'CANCELLED'
    ))
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

export function buildBilledHardwareCharges(
  packages = [],
  jobId,
  excludedPackageId = null,
) {
  const billed = new Map()

  for (const record of packages) {
    if (
      String(record.jobId) !== String(jobId)
      || String(record.id) === String(excludedPackageId)
      || record.status === 'CANCELLED'
    ) continue

    for (const line of record.persistedDrawLines ?? []) {
      if (
        line.isUtilityBuilding
        || ((Number(line.hardwarePercentage) || 0) <= 0
          && (Number(line.hardwareAmount) || 0) <= 0)
      ) continue

      const billingMode = line.hardwareBillingMode === 'BY_EVENT'
        ? 'BY_EVENT'
        : 'FULL'
      const eventType = line.hardwareEventType ?? line.eventType ?? null
      const key = hardwareChargeKey(line.lotId, billingMode, eventType)
      if (billed.has(key)) continue

      billed.set(key, {
        lotId: line.lotId,
        drawIndex: line.drawIndex,
        billingMode,
        eventType,
        packageId: record.id,
        packageNumber: record.packageNumber,
        hardwareAmount: Number(line.hardwareAmount),
      })
    }

    for (const line of record.persistedHardwareLines ?? []) {
      const key = hardwareChargeKey(
        line.lotId,
        'BY_EVENT',
        line.hardwareEventType,
      )
      if (billed.has(key)) continue

      billed.set(key, {
        lotId: line.lotId,
        drawIndex: null,
        billingMode: 'BY_EVENT',
        eventType: line.hardwareEventType,
        packageId: record.id,
        packageNumber: record.packageNumber,
        hardwareAmount: Number(line.hardwareAmount),
      })
    }
  }

  return billed
}

export function buildBilledHardwareLots(packages = [], jobId) {
  const billed = new Map()
  for (const charge of buildBilledHardwareCharges(packages, jobId).values()) {
    if (!billed.has(String(charge.lotId))) {
      billed.set(String(charge.lotId), charge)
    }
  }
  return billed
}

export function buildBilledUtilityRows(
  packages = [],
  jobId,
  excludedPackageId = null,
) {
  const billedCharges = buildBilledUtilityCharges(
    packages,
    jobId,
    excludedPackageId,
  )
  const billed = new Map()

  for (const charge of billedCharges.values()) {
    if (!billed.has(String(charge.lotId))) {
      billed.set(String(charge.lotId), {
        lotId: charge.lotId,
        drawIndex: charge.drawIndex,
        packageId: charge.packageId,
        packageNumber: charge.packageNumber,
        utilityAmount: charge.utilityAmount,
      })
    }
  }

  return billed
}

export function buildBilledUtilityCharges(
  packages = [],
  jobId,
  excludedPackageId = null,
) {
  const billed = new Map()

  for (const record of packages) {
    if (
      String(record.jobId) !== String(jobId)
      || String(record.id) === String(excludedPackageId)
      || record.status === 'CANCELLED'
    ) continue

    for (const line of record.persistedDrawLines ?? []) {
      if (!line.isUtilityBuilding) continue

      const billingMode = line.utilityBillingMode === 'BY_EVENT'
        ? 'BY_EVENT'
        : 'FULL'
      const eventType = line.utilityEventType ?? line.eventType ?? null
      const key = utilityChargeKey(line.lotId, billingMode, eventType)
      if (billed.has(key)) continue

      billed.set(key, {
        lotId: line.lotId,
        drawIndex: line.drawIndex,
        billingMode,
        eventType,
        packageId: record.id,
        packageNumber: record.packageNumber,
        // To name the invoice that bills it, like the cells of the Lots do.
        invoiceNumber: record.invoiceNumber ?? null,
        quickbooksStatus: record.quickbooksStatus,
        quickbooksReference: record.quickbooksReference ?? null,
        paymentState: record.paymentState ?? null,
        paymentOverdue: Boolean(record.paymentOverdue),
        utilityAmount: Number(line.utilityAmount),
      })
    }
  }

  return billed
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

/**
 * What the selected cells of a Lot / Draw grid add up to, by Draw and in all: how many cells are
 * ticked and their amounts, in cents so the sums are exact. `isSelected(rowId, drawIndex)` says
 * whether a cell is ticked; a cell with no amount counts as ticked but adds nothing.
 */
export function summarizeSelectedDrawCells(rows = [], drawCount = 0, isSelected = () => false) {
  const draws = Array.from({ length: drawCount }, () => ({ count: 0, total: 0 }))

  for (const row of rows) {
    for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
      if (!isSelected(row.id, drawIndex)) continue
      draws[drawIndex].count += 1
      draws[drawIndex].total = addCurrencyAmounts(draws[drawIndex].total, row.drawAmounts?.[drawIndex])
    }
  }

  return {
    draws,
    count: draws.reduce((sum, draw) => sum + draw.count, 0),
    total: addCurrencyAmounts(...draws.map((draw) => draw.total)),
  }
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
      priceNotApplicable: option.priceNotApplicable === true,
      issue: hasOptionPrice(option.price) ? null : 'PRICE_MISSING',
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
      utilityLabels: [],
      hasUtilityRows: Boolean(line.isUtilityBuilding),
      draws: new Map(),
    }
    if (line.isUtilityBuilding) {
      group.hasUtilityRows = true
      group.utilityLabels.push(line.utilityLabel ?? line.lotNumber)
    } else {
      group.lotNumbers.push(line.lotNumber)
    }
    if (line.drawIndex != null) {
      const draw = group.draws.get(line.drawIndex) ?? {
        drawIndex: line.drawIndex,
        lotNumbers: [],
        utilityLabels: [],
      }
      if (line.isUtilityBuilding) {
        draw.utilityLabels.push(line.utilityLabel ?? line.lotNumber)
      } else {
        draw.lotNumbers.push(line.lotNumber)
      }
      group.draws.set(line.drawIndex, draw)
    }
    grouped.set(String(phaseId), group)
  }

  return [...grouped.values()]
    .map((group) => ({
      phaseId: group.phaseId,
      phaseCode: group.phaseCode,
      building: group.building,
      hasUtilityRows: group.hasUtilityRows,
      utilityCount: new Set(group.utilityLabels).size,
      lotRange: formatLotRange(group.lotNumbers),
      draws: [...group.draws.values()]
        .sort((left, right) => left.drawIndex - right.drawIndex)
        .map((draw) => ({
          ...draw,
          utilityCount: new Set(draw.utilityLabels).size,
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
  const selectionIsUtility = (selection) => Boolean(
    rowForSelection(selection)?.isUtilityBuilding,
  )
  const selections = record?.selections ?? []
  const hardwareSelections = record?.hardwareSelections ?? []
  const scopeEventTypes = getPackageScopeEventTypes(record, selections, schedule)
  const selectedRows = [...new Map([
    ...selections,
    ...hardwareSelections.filter((selection) => selection.chargeHardware !== false),
  ].map((selection) => {
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
        (selection) => !selectionIsUtility(selection)
          && isAtOrAfterOptionsBillingDraw(
          selection.drawIndex,
          optionsBillingDrawIndex,
        ),
      )
      .map((selection) => {
        const scope = scopeForSelection(selection)
        return `${scope?.phaseId ?? selection.phaseId}:${selection.lotId}`
      }),
  )
  const optionChargeDrawIndexes = selections
    .filter((selection) => !selectionIsUtility(selection))
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
    if (!selectionIsUtility(selection) && isAtOrAfterOptionsBillingDraw(
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
      billedPriceNotApplicable: billed.priceNotApplicable === true,
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
    const persistedHardwareLines = [
      ...(record.persistedHardwareLines ?? []),
      ...persistedLines.filter((line) => (
        Number(line.hardwarePercentage) > 0 || Number(line.hardwareAmount) > 0
      )),
    ]
    const persistedUtilityLines = persistedLines.filter(
      (line) => line.isUtilityBuilding || Number(line.utilityAmount) > 0,
    )
    const persistedLotLines = [
      ...persistedLines.filter((line) => !line.isUtilityBuilding),
      ...(record.persistedHardwareLines ?? []).map((line) => ({
        ...line,
        drawIndex: null,
        isUtilityBuilding: false,
      })),
    ]
    const separateHardwarePrice = Boolean(
      record.separateHardwarePrice
      ?? schedule?.separateHardwarePrice,
    ) || persistedHardwareLines.length > 0
    const hardwareRows = persistedHardwareLines
    const hardwareTotal = hardwareRows.reduce(
      (total, line) => addCurrencyAmounts(total, line.hardwareAmount),
      0,
    )
    const utilityRows = persistedUtilityLines
    const utilityTotal = utilityRows.reduce(
      (total, line) => addCurrencyAmounts(total, line.utilityAmount),
      0,
    )
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
    const lotNumbers = persistedLotLines.map((line) => line.lotNumber)
    const phaseSummaries = buildPhaseSummaries([
      ...persistedLines,
      ...(record.persistedHardwareLines ?? []).map((line) => ({
        ...line,
        drawIndex: null,
        isUtilityBuilding: false,
      })),
    ], phaseById)

    return {
      worksheet: phaseScopes[0]?.worksheet ?? buildDrawWorksheet(job, null, schedule),
      worksheets: phaseScopes.map(({ phase, phaseId, worksheet }) => ({
        phase, phaseId, worksheet,
      })),
      selectedRows,
      lotCount: new Set(persistedLotLines.map((line) => String(line.lotId))).size,
      lotRange: phaseSummaries.length <= 1
        ? formatLotRange(lotNumbers)
        : phaseSummaries.map((scope) => (
            `${phaseDisplayName(phaseById.get(String(scope.phaseId)), scope.phaseCode)}: ${scope.lotRange}`
          )).join(' · '),
      phaseSummaries,
      phaseCount: phaseSummaries.length,
      scopeCount: persistedLines.length + (record.persistedHardwareLines?.length ?? 0),
      scopeEventTypes,
      currentDraw: record.persistedInvoice.grossAmount,
      utilityRows,
      utilityCount: new Set(utilityRows.map((line) => String(line.lotId))).size,
      utilityTotal,
      separateHardwarePrice,
      hardwareIsDue: hardwareRows.length > 0,
      hardwareRows,
      hardwareTotal,
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
  const baseCurrentDraw = sumSelectionAmounts(
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
  const separateHardwarePrice = Boolean(schedule?.separateHardwarePrice)
  const hardwareBillingMode = getHardwareBillingMode(schedule)
  const hardwareSelectionKeys = new Set(
    record?.hardwareSelectionKeys
      ?? selections
        .filter((selection) => selection.chargeHardware)
        .map(({ phaseId, lotId, drawIndex }) => (
          hardwareSelectionKey(phaseId, lotId, drawIndex)
        )),
  )
  const hardwareCandidates = !separateHardwarePrice
    ? []
    : hardwareBillingMode === 'BY_EVENT'
      ? hardwareSelections.flatMap((selection) => {
          const scope = scopeForSelection(selection)
          const row = rowForSelection(selection)
          const eventType = selection.eventType
          if (!scope || !row || row.isUtilityBuilding) return []
          const selectionKey = hardwareEventSelectionKey(
            scope.phaseId,
            row.id,
            eventType,
          )
          return [{
            selectionKey,
            phaseId: scope.phaseId,
            phaseCode: scope.phase.name ?? scope.phase.code ?? null,
            building: scope.phase.building ?? null,
            lotId: row.id,
            lotNumber: row.lotNumber,
            planCode: row.planCode,
            drawIndex: null,
            drawName: '',
            eventType,
            hardwareBillingMode,
            hardwareEventType: eventType,
            hardwarePercentage: getHardwareEventPercentage(schedule, eventType),
            hardwareAmount: row.hardwareEventAmounts?.[eventType] ?? 0,
            chargeHardware: selection.chargeHardware !== false,
            isCalendarSuggested: Boolean(selection.isCalendarSuggested),
          }]
        })
      : selections.flatMap((selection) => {
        const scope = scopeForSelection(selection)
        const row = rowForSelection(selection)
        if (!scope || !row || row.isUtilityBuilding) return []
        const selectionKey = hardwareSelectionKey(
          scope.phaseId,
          row.id,
          selection.drawIndex,
        )
        return [{
          selectionKey,
          phaseId: scope.phaseId,
          phaseCode: scope.phase.name ?? scope.phase.code ?? null,
          building: scope.phase.building ?? null,
          lotId: row.id,
          lotNumber: row.lotNumber,
          planCode: row.planCode,
          drawIndex: selection.drawIndex,
          drawName: schedule.draws?.[selection.drawIndex]?.name ?? '',
          eventType: schedule.draws?.[selection.drawIndex]?.eventType ?? null,
          hardwareBillingMode,
          hardwareEventType: null,
          hardwarePercentage: 100,
          hardwareAmount: row.hardwarePrice,
          chargeHardware: hardwareSelectionKeys.has(selectionKey),
        }]
      })
  const hardwareRows = hardwareCandidates.filter((candidate, index) => (
    hardwareBillingMode !== 'BY_EVENT'
    || (
      candidate.hardwarePercentage > 0
      && hardwareCandidates.findIndex((row) => (
        String(row.lotId) === String(candidate.lotId)
        && row.hardwareEventType === candidate.hardwareEventType
      )) === index
    )
  ))
  const hardwareTotal = hardwareRows
    .filter((row) => row.chargeHardware)
    .reduce(
      (total, row) => addCurrencyAmounts(total, row.hardwareAmount),
      0,
    )
  const hardwareFinancials = calculateInvoiceAmounts(hardwareTotal, schedule)
  const currentDraw = addCurrencyAmounts(baseCurrentDraw, hardwareTotal)
  const optionFinancials = calculateInvoiceAmounts(optionsTotal, schedule)
  const utilityRows = selections.flatMap((selection) => {
    const scope = scopeForSelection(selection)
    const row = rowForSelection(selection)
    if (!scope || !row?.isUtilityBuilding) return []
    return [{
      phaseId: scope.phaseId,
      phaseCode: scope.phase.name ?? scope.phase.code ?? null,
      building: scope.phase.building ?? null,
      lotId: row.id,
      lotNumber: row.lotNumber,
      utilityLabel: row.utilityLabel,
      planCode: row.planCode,
      drawIndex: selection.drawIndex,
      drawName: schedule.draws?.[selection.drawIndex]?.name ?? '',
      eventType: schedule.draws?.[selection.drawIndex]?.eventType ?? null,
      utilityBillingMode: getUtilityBillingMode(schedule),
      utilityPercentage: getUtilityBillingMode(schedule) === 'BY_EVENT'
        ? getUtilityEventPercentage(
            schedule,
            schedule.draws?.[selection.drawIndex]?.eventType,
          )
        : 100,
      utilityAmount: row.drawAmounts[selection.drawIndex] ?? 0,
      isUtilityBuilding: true,
    }]
  })
  const utilityTotal = utilityRows.reduce(
    (total, row) => addCurrencyAmounts(total, row.utilityAmount),
    0,
  )
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
      utilityLabel: row.utilityLabel,
      isUtilityBuilding: row.isUtilityBuilding,
      drawIndex: selection.drawIndex,
    }
  }).filter(Boolean)
  const selectedHardwareLines = hardwareRows
    .filter((row) => row.chargeHardware)
    .map((row) => ({
      ...row,
      drawIndex: null,
      isUtilityBuilding: false,
    }))
  const phaseSummaries = buildPhaseSummaries(
    [...selectedLines, ...selectedHardwareLines],
    phaseById,
  )

  return {
    worksheet: phaseScopes[0]?.worksheet ?? buildDrawWorksheet(job, null, schedule),
    worksheets: phaseScopes.map(({ phase, phaseId, worksheet }) => ({
      phase, phaseId, worksheet,
    })),
    selectedRows,
    lotCount: selectedRows.filter((row) => !row.isUtilityBuilding).length,
    lotRange: phaseSummaries.length <= 1
      ? formatLotRange(
          selectedRows
            .filter((row) => !row.isUtilityBuilding)
            .map((row) => row.lotNumber),
        )
      : phaseSummaries.map((scope) => (
          `${phaseDisplayName(phaseById.get(String(scope.phaseId)), scope.phaseCode)}: ${scope.lotRange}`
        )).join(' · '),
    phaseSummaries,
    phaseCount: phaseSummaries.length,
    scopeCount: selections.length + selectedHardwareLines.length,
    scopeEventTypes,
    currentDraw,
    utilityRows,
    utilityCount: new Set(utilityRows.map((row) => String(row.lotId))).size,
    utilityTotal,
    separateHardwarePrice,
    hardwareIsDue: hardwareRows.some((row) => row.chargeHardware),
    hardwareRows,
    hardwareTotal,
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
    retention: addCurrencyAmounts(
      baseRetention,
      hardwareFinancials.retention,
      optionFinancials.retention,
    ),
    wrapInsurance: addCurrencyAmounts(
      baseWrapInsurance,
      hardwareFinancials.wrapInsurance,
      optionFinancials.wrapInsurance,
    ),
    invoiceAmount: addCurrencyAmounts(
      baseInvoiceAmount,
      hardwareFinancials.invoiceAmount,
      optionFinancials.invoiceAmount,
    ),
  }
}
