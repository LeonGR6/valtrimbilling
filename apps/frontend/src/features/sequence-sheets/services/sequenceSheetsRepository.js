import { requireSupabase } from '../../../services/api.js'
import {
  toLotOptionPrice,
  toLotPlanPrice,
  toSequenceSheetLot,
  toSequenceSheetPhase,
  toSequenceSheetPhaseRpc,
} from './sequenceSheetRecord.js'
import { inBatches, listAllRows as listPagedRows } from '../../../services/pagedQuery.js'

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
  'utility_name',
  'is_reverse',
  'is_utility_building',
  'display_order',
  'plan_price_id',
].join(', ')

const LOT_OPTION_COLUMNS = [
  'lot_id',
  'option_id',
  'option_price_id',
].join(', ')

const PLAN_PRICE_COLUMNS = ['id', 'base_price', 'hardware_price'].join(', ')

const OPTION_PRICE_COLUMNS = ['id', 'price', 'is_not_applicable'].join(', ')

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Sequence Sheets.', {
      cause: error,
    })
  }

  if (error.code === '23505') {
    throw new Error('That Phase and Building, or that Lot number, already exists in this Sequence Sheet.', {
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

function distinctIds(values) {
  return [...new Set(values.filter((value) => value != null))]
}

async function listPriceRows(client, table, columns, ids) {
  if (ids.length === 0) return []

  return (await Promise.all(inBatches(ids).map((batch) => listAllRows(() => client
    .from(table)
    .select(columns)
    .in('id', batch)
    .order('id', { ascending: true }))
  ))).flat()
}

// Every row of a query, page by page, throwing this repository's error.
const listAllRows = (queryFactory) => listPagedRows(queryFactory, throwRepositoryError)

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

  // The prices each Lot and selected Option were created with.
  const planPriceIds = distinctIds(lotRows.map((row) => row.plan_price_id))
  const optionPriceIds = distinctIds(selectedOptionRows.map((row) => row.option_price_id))
  const [planPriceRows, optionPriceRows] = await Promise.all([
    listPriceRows(client, 'plan_prices', PLAN_PRICE_COLUMNS, planPriceIds),
    listPriceRows(client, 'option_prices', OPTION_PRICE_COLUMNS, optionPriceIds),
  ])
  const planPrices = new Map(planPriceRows.map((row) => [row.id, toLotPlanPrice(row)]))
  const optionPrices = new Map(optionPriceRows.map((row) => [row.id, toLotOptionPrice(row)]))

  const optionIdsByLot = new Map()
  const optionPricesByLot = new Map()
  selectedOptionRows.forEach((row) => {
    appendToGroup(optionIdsByLot, row.lot_id, row.option_id)
    const price = optionPrices.get(row.option_price_id)
    if (price) {
      optionPricesByLot.set(row.lot_id, {
        ...(optionPricesByLot.get(row.lot_id) ?? {}),
        [row.option_id]: price,
      })
    }
  })

  const lotsByPhase = new Map()
  lotRows.forEach((row) => {
    appendToGroup(
      lotsByPhase,
      row.phase_id,
      toSequenceSheetLot(row, optionIdsByLot.get(row.id) ?? [], {
        planPrice: planPrices.get(row.plan_price_id),
        optionPrices: optionPricesByLot.get(row.id),
      }),
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
