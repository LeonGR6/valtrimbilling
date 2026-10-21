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

/**
 * The options a saved edit took out of Lots that already existed: the ones the Lot had
 * before and the form no longer selects. Changing a Lot's Plan drops the options of its
 * old Plan too, and counts the same. Each carries the price the Lot was billing, which is
 * gone once the selection is deleted. A Lot that is removed altogether is not listed:
 * the email is about options, and the Lot is not there to describe any more.
 */
export function removedOptionChanges(previousPhase, form) {
  const previousLots = new Map((previousPhase?.lots ?? []).map((lot) => [String(lot.id), lot]))
  const changes = []

  for (const lot of form.lots ?? []) {
    if (lot.id == null || lot.isUtilityBuilding) continue
    const previous = previousLots.get(String(lot.id))
    if (!previous || previous.isUtilityBuilding) continue

    const kept = new Set((lot.optionIds ?? []).map(String))
    for (const optionId of previous.optionIds ?? []) {
      if (kept.has(String(optionId))) continue
      const price = previous.optionPrices?.[optionId]
      changes.push({
        lotId: Number(lot.id),
        optionId: Number(optionId),
        // Without a pinned price the server shows what the Plan holds today.
        ...(price ? { price: price.price, priceNotApplicable: price.priceNotApplicable } : {}),
      })
    }
  }

  return changes
}
