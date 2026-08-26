const PERCENTAGE_TOLERANCE = 0.001

export function hasPlanPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
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

function compareLotNumbers(left, right) {
  return String(left.lotNumber).localeCompare(String(right.lotNumber), 'en', {
    numeric: true,
    sensitivity: 'base',
  })
}


export function buildDrawWorksheet(job, phase, schedule) {
  const plans = job?.sequenceSheet?.plans ?? []
  const lots = [...(phase?.lots ?? [])].sort(compareLotNumbers)
  const draws = schedule?.draws ?? []
  const scheduleIsValid = isDrawScheduleValid(schedule)
  const separateHardwarePrice = Boolean(schedule?.separateHardwarePrice)

  const rows = lots.map((lot) => {
    const plan = plans.find((candidate) => String(candidate.id) === String(lot.planId))
    const basePrice = plan?.price
    const priceIsAvailable = hasPlanPrice(basePrice)
    const hardwarePrice = plan?.hardwarePrice
    const hardwarePriceIsAvailable = !separateHardwarePrice
      || hasHardwarePrice(hardwarePrice)
    const hardwarePriceIsValid = hardwarePriceIsAvailable
      && (!separateHardwarePrice || !priceIsAvailable || hardwarePrice <= basePrice)
    const drawBasePrice = priceIsAvailable && hardwarePriceIsValid
      ? basePrice - (separateHardwarePrice ? hardwarePrice : 0)
      : null

    return {
      id: lot.id,
      lot,
      lotNumber: lot.lotNumber,
      plan,
      planCode: plan?.code ?? null,
      basePrice: priceIsAvailable ? basePrice : null,
      drawBasePrice,
      hardwarePrice: separateHardwarePrice && hardwarePriceIsAvailable
        ? hardwarePrice
        : null,
      drawAmounts: scheduleIsValid && hasPlanPrice(drawBasePrice)
        ? allocateDrawAmounts(drawBasePrice, draws)
        : draws.map(() => null),
      issue: !plan
        ? 'PLAN_MISSING'
        : !priceIsAvailable
          ? 'PRICE_MISSING'
          : !hardwarePriceIsAvailable
            ? 'HARDWARE_PRICE_MISSING'
            : !hardwarePriceIsValid
              ? 'HARDWARE_PRICE_INVALID'
              : null,
    }
  })

  const missingPlanCount = rows.filter((row) => row.issue === 'PLAN_MISSING').length
  const unpricedLotCount = rows.filter((row) => row.issue === 'PRICE_MISSING').length
  const missingHardwarePriceCount = rows.filter(
    (row) => row.issue === 'HARDWARE_PRICE_MISSING',
  ).length
  const invalidHardwarePriceCount = rows.filter(
    (row) => row.issue === 'HARDWARE_PRICE_INVALID',
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

  return {
    draws,
    rows,
    totalBasePrice,
    totalDrawBasePrice,
    totalHardwarePrice,
    drawTotals,
    missingPlanCount,
    unpricedLotCount,
    missingHardwarePriceCount,
    invalidHardwarePriceCount,
    separateHardwarePrice,
    hasSchedule: Boolean(schedule),
    scheduleIsValid,
    isReady:
      Boolean(schedule)
      && scheduleIsValid
      && rows.length > 0
      && missingPlanCount === 0
      && unpricedLotCount === 0
      && missingHardwarePriceCount === 0
      && invalidHardwarePriceCount === 0,
  }
}
