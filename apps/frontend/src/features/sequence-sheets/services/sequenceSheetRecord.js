function requiredId(value) {
  return Number(value)
}

function moneyValue(value) {
  return value == null ? null : Number(value)
}

export function toLotPlanPrice(row) {
  return {
    id: row.id,
    basePrice: moneyValue(row.base_price),
    hardwarePrice: moneyValue(row.hardware_price),
  }
}

export function toLotOptionPrice(row) {
  return {
    id: row.id,
    price: moneyValue(row.price),
    priceNotApplicable: Boolean(row.is_not_applicable),
  }
}

/**
 * `prices` carries what the Lot was created with: its Plan price and, by Option
 * id, the price of each selected Option. A Phase bills those, not today's price.
 * Older rows pinned to nothing leave them out and use the Plan's current price.
 */
export function toSequenceSheetLot(row, optionIds = [], prices = {}) {
  const optionPrices = prices.optionPrices ?? {}

  return {
    id: row.id,
    lotNumber: row.lot_number,
    utilityName: row.utility_name ?? '',
    planId: row.plan_id,
    reverse: row.is_reverse,
    optionIds: [...optionIds],
    isUtilityBuilding: Boolean(row.is_utility_building),
    ...(prices.planPrice ? { planPrice: prices.planPrice } : {}),
    ...(Object.keys(optionPrices).length > 0 ? { optionPrices } : {}),
  }
}

export function toSequenceSheetPhase(row, lots = []) {
  return {
    id: row.id,
    name: row.code,
    building: row.building ?? '',
    createdAt: row.created_at.slice(0, 10),
    lots: [...lots],
  }
}

export function toSequenceSheetPhaseRpc(jobId, phaseId, phase) {
  return {
    p_job_id: requiredId(jobId),
    p_phase_id: phaseId == null ? null : requiredId(phaseId),
    p_code: phase.phaseName.trim().toUpperCase(),
    // A Phase can have no Building: an empty one is sent as nothing.
    p_building: phase.building.trim().toUpperCase() || null,
    p_lots: phase.lots.map((lot) => ({
      id: lot.id == null ? null : requiredId(lot.id),
      lot_number: lot.isUtilityBuilding ? '' : lot.lotNumber.trim().toUpperCase(),
      utility_name: lot.isUtilityBuilding ? (lot.utilityName ?? '').trim() : null,
      plan_id: requiredId(lot.planId),
      is_reverse: Boolean(lot.reverse),
      option_ids: lot.isUtilityBuilding
        ? []
        : (lot.optionIds ?? []).map(requiredId),
      is_utility_building: Boolean(lot.isUtilityBuilding),
    })),
    p_is_utility_building: false,
  }
}
