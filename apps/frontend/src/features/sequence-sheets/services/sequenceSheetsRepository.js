import { requireSupabase } from '../../../services/api.js'
import {
  toSequenceSheetLot,
  toSequenceSheetPhase,
  toSequenceSheetPhaseRpc,
} from './sequenceSheetRecord.js'

const PHASE_COLUMNS = [
  'id',
  'job_id',
  'code',
  'building',
  'is_active',
  'created_at',
].join(', ')

const LOT_COLUMNS = [
  'id',
  'phase_id',
  'plan_id',
  'lot_number',
  'is_reverse',
  'display_order',
].join(', ')

const LOT_OPTION_COLUMNS = [
  'lot_id',
  'option_id',
].join(', ')

const PAGE_SIZE = 1000
const FILTER_BATCH_SIZE = 200

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Sequence Sheets.', {
      cause: error,
    })
  }

  if (error.code === '23505') {
    throw new Error('That Phase or Lot number already exists in this Sequence Sheet.', {
      cause: error,
    })
  }

  if (error.code === '23503') {
    if (error.message?.includes('Production') || error.details?.includes('production')) {
      throw new Error('This Phase cannot be deleted because its Lots are already in use.', {
        cause: error,
      })
    }

    throw new Error('A selected Job, Phase, Plan or Option is no longer available.', {
      cause: error,
    })
  }

  if (error.code === '23514' || error.code === '22023' || error.code === '22P02') {
    throw new Error(error.message || 'Review the Phase and Lot assignments.', {
      cause: error,
    })
  }

  throw new Error(error.message || 'The Sequence Sheets request failed.', {
    cause: error,
  })
}

function appendToGroup(grouped, key, value) {
  const items = grouped.get(key) ?? []
  items.push(value)
  grouped.set(key, items)
}

function inBatches(values) {
  const batches = []
  for (let index = 0; index < values.length; index += FILTER_BATCH_SIZE) {
    batches.push(values.slice(index, index + FILTER_BATCH_SIZE))
  }
  return batches
}

async function listAllRows(queryFactory) {
  const rows = []
  let start = 0

  while (true) {
    const { data, error } = await queryFactory().range(
      start,
      start + PAGE_SIZE - 1,
    )
    throwRepositoryError(error)

    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    start += PAGE_SIZE
  }
}

export async function listSequenceSheetPhases(jobIds) {
  const normalizedJobIds = [...new Set(jobIds.map(Number).filter(Number.isFinite))]
  if (normalizedJobIds.length === 0) return new Map()

  const client = await requireSupabase()
  const jobIdBatches = inBatches(normalizedJobIds)
  const [phaseBatchRows, lotBatchRows] = await Promise.all([
    Promise.all(jobIdBatches.map((batch) => listAllRows(() => client
      .from('phases')
      .select(PHASE_COLUMNS)
      .in('job_id', batch)
      .eq('is_active', true)
      .order('id', { ascending: true }))
    )),
    Promise.all(jobIdBatches.map((batch) => listAllRows(() => client
      .from('lots')
      .select(LOT_COLUMNS)
      .in('job_id', batch)
      .order('phase_id', { ascending: true })
      .order('display_order', { ascending: true })
      .order('id', { ascending: true }))
    )),
  ])
  const phaseRows = phaseBatchRows.flat().sort((left, right) => left.id - right.id)
  if (phaseRows.length === 0) return new Map()

  const activePhaseIds = new Set(phaseRows.map(({ id }) => id))
  const lotRows = lotBatchRows
    .flat()
    .filter((row) => activePhaseIds.has(row.phase_id))
  const lotIds = lotRows.map(({ id }) => id)
  const selectedOptionRows = lotIds.length === 0
    ? []
    : (await Promise.all(inBatches(lotIds).map((batch) => listAllRows(() => client
        .from('lot_options')
        .select(LOT_OPTION_COLUMNS)
        .in('lot_id', batch)
        .order('lot_id', { ascending: true })
        .order('option_id', { ascending: true }))
      ))).flat()

  const optionIdsByLot = new Map()
  selectedOptionRows.forEach((row) => {
    appendToGroup(optionIdsByLot, row.lot_id, row.option_id)
  })

  const lotsByPhase = new Map()
  lotRows.forEach((row) => {
    appendToGroup(
      lotsByPhase,
      row.phase_id,
      toSequenceSheetLot(row, optionIdsByLot.get(row.id) ?? []),
    )
  })

  return phaseRows.reduce((grouped, row) => {
    appendToGroup(
      grouped,
      row.job_id,
      toSequenceSheetPhase(row, lotsByPhase.get(row.id) ?? []),
    )
    return grouped
  }, new Map())
}

export async function saveSequenceSheetPhase(jobId, phaseId, phase) {
  const client = await requireSupabase()
  const { data: savedPhaseId, error } = await client.rpc(
    'save_sequence_sheet_phase',
    toSequenceSheetPhaseRpc(jobId, phaseId, phase),
  )

  throwRepositoryError(error)

  const phasesByJob = await listSequenceSheetPhases([jobId])
  const savedPhase = (phasesByJob.get(Number(jobId)) ?? []).find(
    (candidate) => candidate.id === savedPhaseId,
  )

  if (!savedPhase) {
    throw new Error('The saved Phase could not be reloaded.')
  }

  return savedPhase
}

export async function deactivateSequenceSheetPhase(phaseId) {
  const client = await requireSupabase()
  const { error } = await client.rpc('deactivate_sequence_sheet_phase', {
    p_phase_id: Number(phaseId),
  })

  throwRepositoryError(error)
}
