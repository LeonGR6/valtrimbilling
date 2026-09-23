function requiredId(value) {
  return Number(value)
}

export function toSequenceSheetLot(row, optionIds = []) {
  return {
    id: row.id,
    lotNumber: row.lot_number,
    planId: row.plan_id,
    reverse: row.is_reverse,
    optionIds: [...optionIds],
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
    p_building: phase.building.trim().toUpperCase(),
    p_lots: phase.lots.map((lot) => ({
      id: lot.id == null ? null : requiredId(lot.id),
      lot_number: lot.lotNumber.trim().toUpperCase(),
      plan_id: requiredId(lot.planId),
      is_reverse: Boolean(lot.reverse),
      option_ids: (lot.optionIds ?? []).map(requiredId),
    })),
  }
}
