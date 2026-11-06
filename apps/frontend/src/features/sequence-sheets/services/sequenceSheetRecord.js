import { cleanElevation } from '../utils/lotElevation.js'
import { optionDetailsPayload } from '../utils/optionDetails.js'

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
 * `prices.optionDetails` has the quantity and locations of the Options that are more than one unit
 * or have a place (by Option id); the others are one unit with no place and are left out.
 */
export function toSequenceSheetLot(row, optionIds = [], prices = {}) {
  const optionPrices = prices.optionPrices ?? {}
  const optionDetails = prices.optionDetails ?? {}

  return {
    id: row.id,
    lotNumber: row.lot_number,
    utilityName: row.utility_name ?? '',
    planId: row.plan_id,
    reverse: row.is_reverse,
    // Apart from the Plan; empty when the Lot has none.
    elevation: row.elevation ?? '',
    optionIds: [...optionIds],
    isUtilityBuilding: Boolean(row.is_utility_building),
    ...(prices.planPrice ? { planPrice: prices.planPrice } : {}),
    ...(Object.keys(optionPrices).length > 0 ? { optionPrices } : {}),
    ...(Object.keys(optionDetails).length > 0 ? { optionDetails } : {}),
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
      // Always sent, even empty: an empty one clears it. A Utility row has none.
      elevation: lot.isUtilityBuilding ? '' : cleanElevation(lot.elevation),
      option_ids: lot.isUtilityBuilding
        ? []
        : (lot.optionIds ?? []).map(requiredId),
      // Always sent, even empty: a save that carries the details also puts back to one unit the Options
      // that no longer have a quantity or a place.
      option_details: lot.isUtilityBuilding ? [] : optionDetailsPayload(lot),
      is_utility_building: Boolean(lot.isUtilityBuilding),
    })),
    p_is_utility_building: false,
  }
}

/**
 * The options a saved edit took out of Lots that already existed: the ones the Lot had
 * before and the form no longer selects. Changing a Lot's Plan drops the options of its
 * old Plan too, and counts the same. A Lot that is removed altogether is not listed:
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
      changes.push({ lotId: Number(lot.id), optionId: Number(optionId) })
    }
  }

  return changes
}

/**
 * The options a saved edit put into Lots: the ones a Lot now has that it did not have
 * before. Read from the Phase as it was saved, so the Lots the edit created are there too
 * with their new ids, and all their options count. A Lot whose Plan changed gets the
 * options of the new Plan. Utility rows carry no options.
 */
export function addedOptionChanges(previousPhase, savedPhase) {
  const previousLots = new Map((previousPhase?.lots ?? []).map((lot) => [String(lot.id), lot]))
  const changes = []

  for (const lot of savedPhase?.lots ?? []) {
    if (lot.isUtilityBuilding) continue
    const had = new Set((previousLots.get(String(lot.id))?.optionIds ?? []).map(String))
    for (const optionId of lot.optionIds ?? []) {
      if (had.has(String(optionId))) continue
      changes.push({ lotId: Number(lot.id), optionId: Number(optionId) })
    }
  }

  return changes
}
