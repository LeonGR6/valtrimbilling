const PERCENTAGE_TOLERANCE = 0.001
const BILLING_EVENT_TYPES = ['EXT', 'DM', 'HW']

export function hasPlanPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

// An Option can be a credit, so its price may be negative.
export function hasOptionPrice(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function hasHardwarePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function getDrawPercentageTotal(draws = []) {
  return draws.reduce(
    (total, draw) => total + (Number(draw.percentage) || 0),
    0,
  )
}

export function isDrawScheduleValid(schedule) {
  const draws = schedule?.draws ?? []

  return draws.length > 0
    && draws.every((draw) => {
      const percentage = Number(draw.percentage)
      return Number.isFinite(percentage) && percentage > 0
    })
    && Math.abs(getDrawPercentageTotal(draws) - 100) <= PERCENTAGE_TOLERANCE
}

export function allocateDrawAmounts(basePrice, draws = []) {
  if (!hasPlanPrice(basePrice) || draws.length === 0) {
    return draws.map(() => null)
  }

  const totalCents = Math.round(basePrice * 100)
  let allocatedCents = 0

  return draws.map((draw, index) => {
    const isLastDraw = index === draws.length - 1
    const amountCents = isLastDraw
      ? totalCents - allocatedCents
      : Math.round(totalCents * (Number(draw.percentage) || 0) / 100)

    allocatedCents += amountCents
    return amountCents / 100
  })
}

export function getUtilityBillingMode(schedule) {
  return schedule?.utilityBillingMode === 'BY_EVENT' ? 'BY_EVENT' : 'FULL'
}

export function getUtilityEventPercentage(schedule, eventType) {
  if (getUtilityBillingMode(schedule) !== 'BY_EVENT') return 100
  if (!BILLING_EVENT_TYPES.includes(eventType)) return 0
  return Number(schedule?.utilityEventPercentages?.[eventType]) || 0
}

export function getHardwareBillingMode(schedule) {
  return schedule?.separateHardwarePrice
    && schedule?.hardwareBillingMode === 'BY_EVENT'
    ? 'BY_EVENT'
    : 'FULL'
}

export function getHardwareEventPercentage(schedule, eventType) {
  if (getHardwareBillingMode(schedule) !== 'BY_EVENT') return 100
  if (!BILLING_EVENT_TYPES.includes(eventType)) return 0
  return Number(schedule?.hardwareEventPercentages?.[eventType]) || 0
}

function allocateConfiguredEventAmounts(basePrice, schedule, getEventPercentage) {
  if (!hasPlanPrice(basePrice)) return null
  const configuredEvents = BILLING_EVENT_TYPES.filter(
    (eventType) => getEventPercentage(schedule, eventType) > 0,
  )
  const totalCents = Math.round(basePrice * 100)
  let allocatedCents = 0
  const amountByEvent = new Map(configuredEvents.map((eventType, index) => {
    const isLastEvent = index === configuredEvents.length - 1
    const amountCents = isLastEvent
      ? totalCents - allocatedCents
      : Math.round(
          totalCents * getEventPercentage(schedule, eventType) / 100,
        )
    allocatedCents += amountCents
    return [eventType, amountCents / 100]
  }))

  return Object.fromEntries(BILLING_EVENT_TYPES.map((eventType) => [
    eventType,
    amountByEvent.get(eventType) ?? 0,
  ]))
}

function allocateEventAmounts(basePrice, schedule, getEventPercentage) {
  const draws = schedule?.draws ?? []
  if (!hasPlanPrice(basePrice) || draws.length === 0) {
    return draws.map(() => null)
  }
  if (getEventPercentage(schedule, null) === 100) {
    return draws.map(() => basePrice)
  }

  const amountByEvent = allocateConfiguredEventAmounts(
    basePrice,
    schedule,
    getEventPercentage,
  )

  return draws.map((draw) => amountByEvent?.[draw.eventType] ?? 0)
}

export function allocateUtilityAmounts(basePrice, schedule) {
  return allocateEventAmounts(basePrice, schedule, getUtilityEventPercentage)
}

export function allocateHardwareAmounts(hardwarePrice, schedule) {
  return allocateEventAmounts(hardwarePrice, schedule, getHardwareEventPercentage)
}

export function allocateHardwareEventAmounts(hardwarePrice, schedule) {
  return allocateConfiguredEventAmounts(
    hardwarePrice,
    schedule,
    getHardwareEventPercentage,
  ) ?? { EXT: 0, DM: 0, HW: 0 }
}

export function getRetentionMode(schedule) {
  if (schedule?.retentionEnabled) return 'APPLY'
  return 'NONE'
}

// Cents round half away from zero, like the database, so a credit (negative)
// rounds to the mirror image of the same charge.
function roundCents(value) {
  return Math.sign(value) * Math.round(Math.abs(value))
}

// `currentDraw` can be negative when it is the total of Options with credits.
export function calculateInvoiceAmounts(currentDraw, schedule) {
  if (!hasOptionPrice(currentDraw)) {
    return {
      currentDraw: null,
      retention: null,
      wrapInsurance: null,
      invoiceAmount: null,
    }
  }

  const currentDrawCents = roundCents(currentDraw * 100)
  const retentionMode = getRetentionMode(schedule)
  const retentionPercentage = Number(schedule?.retentionPercentage) || 0
  const wrapInsurancePercentage = Number(schedule?.ocipWrapPercentage) || 0
  const shouldApplyRetention = retentionMode === 'APPLY'
    && retentionPercentage > 0
    && retentionPercentage <= 100
  const shouldApplyWrapInsurance = Boolean(schedule?.ocipWrapEnabled)
    && wrapInsurancePercentage > 0
    && wrapInsurancePercentage <= 100
  const retentionCents = shouldApplyRetention
    ? roundCents(currentDrawCents * retentionPercentage / 100)
    : 0
  const wrapInsuranceCents = shouldApplyWrapInsurance
    ? roundCents(currentDrawCents * wrapInsurancePercentage / 100)
    : 0

  return {
    currentDraw: currentDrawCents / 100,
    retention: retentionCents / 100,
    wrapInsurance: wrapInsuranceCents / 100,
    invoiceAmount:
      (currentDrawCents - retentionCents - wrapInsuranceCents) / 100,
  }
}

function compareLotNumbers(left, right) {
  return String(left.lotNumber).localeCompare(String(right.lotNumber), 'en', {
    numeric: true,
    sensitivity: 'base',
  })
}


export function buildDrawWorksheet(job, phase, schedule) {
  const plans = job?.sequenceSheet?.plans ?? []
  const phaseRows = phase?.lots ?? []
  const lots = [
    ...phaseRows.filter((row) => !row.isUtilityBuilding).sort(compareLotNumbers),
    ...phaseRows.filter((row) => row.isUtilityBuilding),
  ]
  const draws = schedule?.draws ?? []
  const scheduleIsValid = isDrawScheduleValid(schedule)
  const separateHardwarePrice = Boolean(schedule?.separateHardwarePrice)
  const hardwareBillingMode = getHardwareBillingMode(schedule)
  const utilityBillingMode = getUtilityBillingMode(schedule)
  const hasUtilityRows = lots.some((lot) => lot.isUtilityBuilding)
  const utilityCapabilityMissing = hasUtilityRows
    && !schedule?.utilityBuilding

  const rows = lots.map((lot) => {
    const isUtilityBuilding = Boolean(lot.isUtilityBuilding)
    const plan = plans.find((candidate) => String(candidate.id) === String(lot.planId))
    const selectedOptionIds = new Set(
      (lot.optionIds ?? []).map((optionId) => String(optionId)),
    )
    // A Lot bills the prices it was created with; the Plan's current price is
    // only for older rows that were never pinned to one.
    const lotPlanPrice = lot.planPrice ?? null
    const selectedOptions = (isUtilityBuilding ? [] : (plan?.options ?? []))
      .filter((option) => selectedOptionIds.has(String(option.id)))
      .map((option) => {
        const lotOptionPrice = lot.optionPrices?.[option.id] ?? null
        const optionPrice = lotOptionPrice ? lotOptionPrice.price : option.price

        return {
          ...option,
          price: hasOptionPrice(optionPrice) ? optionPrice : null,
          ...(lotOptionPrice
            ? { priceNotApplicable: lotOptionPrice.priceNotApplicable }
            : {}),
        }
      })
    const basePrice = lotPlanPrice ? lotPlanPrice.basePrice : plan?.price
    const priceIsAvailable = hasPlanPrice(basePrice)
    const hardwarePrice = lotPlanPrice ? lotPlanPrice.hardwarePrice : plan?.hardwarePrice
    const hardwarePriceIsAvailable = isUtilityBuilding
      || !separateHardwarePrice
      || hasHardwarePrice(hardwarePrice)
    const drawBasePrice = priceIsAvailable && hardwarePriceIsAvailable
      ? basePrice
      : null

    const drawAmounts = scheduleIsValid && hasPlanPrice(drawBasePrice)
      ? isUtilityBuilding
        ? allocateUtilityAmounts(drawBasePrice, schedule)
        : allocateDrawAmounts(drawBasePrice, draws)
      : draws.map(() => null)
    const drawFinancials = drawAmounts.map((amount) =>
      calculateInvoiceAmounts(amount, schedule))
    const hardwareEventAmounts = !isUtilityBuilding
      && separateHardwarePrice
      && hardwarePriceIsAvailable
      && hardwareBillingMode === 'BY_EVENT'
      ? allocateHardwareEventAmounts(hardwarePrice, schedule)
      : { EXT: 0, DM: 0, HW: 0 }
    const hardwareAmounts = !isUtilityBuilding
      && separateHardwarePrice
      && hardwarePriceIsAvailable
      ? hardwareBillingMode === 'BY_EVENT'
        ? draws.map((draw) => hardwareEventAmounts[draw.eventType] ?? 0)
        : draws.map(() => hardwarePrice)
      : draws.map(() => 0)

    return {
      id: lot.id,
      lot,
      lotNumber: lot.lotNumber,
      utilityLabel: isUtilityBuilding
        ? lot.utilityName?.trim() || lot.lotNumber
        : null,
      isUtilityBuilding,
      utilityBillingMode: isUtilityBuilding ? utilityBillingMode : null,
      utilityPercentages: isUtilityBuilding
        ? draws.map((draw) => (
            utilityBillingMode === 'BY_EVENT'
              ? getUtilityEventPercentage(schedule, draw.eventType)
              : 100
          ))
        : draws.map(() => 0),
      plan,
      planCode: plan?.code ?? null,
      selectedOptions,
      basePrice: priceIsAvailable ? basePrice : null,
      drawBasePrice,
      hardwarePrice: !isUtilityBuilding
        && separateHardwarePrice && hardwarePriceIsAvailable
        ? hardwarePrice
        : null,
      hardwareBillingMode: !isUtilityBuilding && separateHardwarePrice
        ? hardwareBillingMode
        : null,
      hardwarePercentages: !isUtilityBuilding && separateHardwarePrice
        ? draws.map((draw) => (
            hardwareBillingMode === 'BY_EVENT'
              ? getHardwareEventPercentage(schedule, draw.eventType)
              : 100
          ))
        : draws.map(() => 0),
      hardwareEventPercentages: !isUtilityBuilding && separateHardwarePrice
        ? Object.fromEntries(BILLING_EVENT_TYPES.map((eventType) => [
            eventType,
            hardwareBillingMode === 'BY_EVENT'
              ? getHardwareEventPercentage(schedule, eventType)
              : 0,
          ]))
        : { EXT: 0, DM: 0, HW: 0 },
      hardwareEventAmounts,
      hardwareAmounts,
      drawAmounts,
      drawRetentionAmounts: drawFinancials.map(({ retention }) => retention),
      drawWrapInsuranceAmounts: drawFinancials.map(
        ({ wrapInsurance }) => wrapInsurance,
      ),
      drawInvoiceAmounts: drawFinancials.map(({ invoiceAmount }) => invoiceAmount),
      issue: !plan
        ? 'PLAN_MISSING'
        : !priceIsAvailable
          ? 'PRICE_MISSING'
          : !hardwarePriceIsAvailable
            ? 'HARDWARE_PRICE_MISSING'
            : null,
    }
  })

  const missingPlanCount = rows.filter((row) => row.issue === 'PLAN_MISSING').length
  const unpricedLotCount = rows.filter((row) => row.issue === 'PRICE_MISSING').length
  const missingHardwarePriceCount = rows.filter(
    (row) => row.issue === 'HARDWARE_PRICE_MISSING',
  ).length
  const pricedRows = rows.filter((row) => hasPlanPrice(row.basePrice))
  const drawableRows = rows.filter((row) => hasPlanPrice(row.drawBasePrice))
  const totalBasePrice = pricedRows.reduce((total, row) => total + row.basePrice, 0)
  const totalDrawBasePrice = drawableRows.reduce(
    (total, row) => total + row.drawBasePrice,
    0,
  )
  const totalHardwarePrice = separateHardwarePrice
    ? rows.reduce(
        (total, row) => total + (row.issue === null ? row.hardwarePrice ?? 0 : 0),
        0,
      )
    : 0
  const drawTotals = draws.map((_, drawIndex) =>
    drawableRows.reduce(
      (total, row) => total + (row.drawAmounts[drawIndex] ?? 0),
      0,
    ))
  const drawRetentionTotals = draws.map((_, drawIndex) =>
    drawableRows.reduce(
      (total, row) => total + (row.drawRetentionAmounts[drawIndex] ?? 0),
      0,
    ))
  const drawInvoiceTotals = draws.map((_, drawIndex) =>
    drawableRows.reduce(
      (total, row) => total + (row.drawInvoiceAmounts[drawIndex] ?? 0),
      0,
    ))
  const drawWrapInsuranceTotals = draws.map((_, drawIndex) =>
    drawableRows.reduce(
      (total, row) => total + (row.drawWrapInsuranceAmounts[drawIndex] ?? 0),
      0,
    ))
  const totalRetention = drawRetentionTotals.reduce(
    (total, amount) => total + amount,
    0,
  )
  const totalInvoiceAmount = drawInvoiceTotals.reduce(
    (total, amount) => total + amount,
    0,
  )
  const totalWrapInsurance = drawWrapInsuranceTotals.reduce(
    (total, amount) => total + amount,
    0,
  )
  const retentionMode = getRetentionMode(schedule)

  return {
    draws,
    rows,
    totalBasePrice,
    totalDrawBasePrice,
    totalHardwarePrice,
    drawTotals,
    drawRetentionTotals,
    drawWrapInsuranceTotals,
    drawInvoiceTotals,
    totalCurrentDraw: totalDrawBasePrice,
    totalRetention,
    totalWrapInsurance,
    totalInvoiceAmount,
    retentionMode,
    retentionPercentage: retentionMode === 'NONE'
      ? 0
      : Number(schedule?.retentionPercentage) || 0,
    wrapInsurancePercentage: schedule?.ocipWrapEnabled
      ? Number(schedule?.ocipWrapPercentage) || 0
      : 0,
    missingPlanCount,
    unpricedLotCount,
    missingHardwarePriceCount,
    hasUtilityRows,
    // Whether the Builder's setup bills a Utility Building at all.
    utilityBuildingEnabled: Boolean(schedule?.utilityBuilding),
    utilityCapabilityMissing,
    separateHardwarePrice,
    hardwareBillingMode,
    utilityBillingMode,
    hasSchedule: Boolean(schedule),
    scheduleIsValid,
    isReady:
      Boolean(schedule)
      && scheduleIsValid
      && !utilityCapabilityMissing
      && rows.length > 0
      && missingPlanCount === 0
      && unpricedLotCount === 0
      && missingHardwarePriceCount === 0,
  }
}
