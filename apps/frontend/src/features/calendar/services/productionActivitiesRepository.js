import { requireSupabase } from '../../../services/api.js'
import {
  toCancelProductionActivityRpc,
  toProductionActivityRpc,
} from './productionActivityRecord.js'

const ACTIVITY_COLUMNS = [
  'id',
  'phase_id',
  'job_id',
  'status',
  'supervisor_id',
  'superintendent_id',
  'supervisor_name',
  'superintendent_name',
  'notes',
  'created_at',
  'updated_at',
].join(', ')

const ACTIVITY_LOT_COLUMNS = 'activity_id, phase_id, lot_id'
const STAGE_COLUMNS = 'id, activity_id, stage_type, is_enabled, order_material'
const SCHEDULE_COLUMNS = [
  'id',
  'stage_id',
  'activity_id',
  'variant',
  'scheduled_date',
  'date_owner',
  'note',
  'lot_start_label',
  'lot_end_label',
  'is_active',
  'created_at',
  'updated_at',
].join(', ')
const SCHEDULE_LOT_COLUMNS = 'schedule_id, lot_id'
const HISTORY_COLUMNS = [
  'id',
  'schedule_id',
  'previous_date',
  'new_date',
  'previous_owner',
  'new_owner',
  'previous_note',
  'new_note',
  'changed_at',
].join(', ')

const PAGE_SIZE = 1000
const FILTER_BATCH_SIZE = 200

function throwRepositoryError(error) {
  if (!error) return

  if (error.code === '42501') {
    throw new Error('You do not have permission to change Production calendar activities.', {
      cause: error,
    })
  }

  if (error.code === '23505') {
    throw new Error('A Production stage or schedule was submitted more than once.', {
      cause: error,
    })
  }

  if (error.code === '23503' || error.code === 'P0002') {
    throw new Error('The selected Production activity, Phase, team or Lot is no longer available.', {
      cause: error,
    })
  }

  if (['22003', '22007', '22008', '22023', '22P02', '23514'].includes(error.code)) {
    throw new Error(error.message || 'Review the Production dates and Lot schedules.', {
      cause: error,
    })
  }

  throw new Error(error.message || 'The Production calendar request failed.', {
    cause: error,
  })
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

function groupRows(rows, key) {
  return rows.reduce((grouped, row) => {
    const items = grouped.get(row[key]) ?? []
    items.push(row)
    grouped.set(row[key], items)
    return grouped
  }, new Map())
}

async function listRowsInBatches(client, ids, table, columns, filter, orders = []) {
  if (ids.length === 0) return []

  const batches = await Promise.all(inBatches(ids).map((batch) => listAllRows(() => {
    let query = client.from(table).select(columns).in(filter, batch)
    for (const [column, ascending] of orders) {
      query = query.order(column, { ascending })
    }
    return query
  })))
  return batches.flat()
}

function toHistory(row) {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    previousDate: row.previous_date,
    newDate: row.new_date,
    previousOwner: row.previous_owner,
    newOwner: row.new_owner,
    previousNote: row.previous_note ?? '',
    newNote: row.new_note ?? '',
    changedAt: row.changed_at,
  }
}

function toSchedule(row, lotIds, history) {
  return {
    id: row.id,
    stageId: row.stage_id,
    activityId: row.activity_id,
    variant: row.variant,
    date: row.scheduled_date,
    dateOwner: row.date_owner,
    note: row.note ?? '',
    lotStartLabel: row.lot_start_label ?? '',
    lotEndLabel: row.lot_end_label ?? '',
    isActive: row.is_active,
    lotIds: [...lotIds],
    history: history.map(toHistory),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toStage(row, schedules) {
  return {
    id: row.id,
    activityId: row.activity_id,
    type: row.stage_type,
    isEnabled: row.is_enabled,
    orderMaterial: row.order_material,
    schedules: [...schedules],
  }
}

function toActivity(row, lotIds, stages) {
  return {
    id: row.id,
    phaseId: row.phase_id,
    jobId: row.job_id,
    status: row.status,
    supervisorId: row.supervisor_id,
    superintendentId: row.superintendent_id,
    supervisorName: row.supervisor_name,
    superintendentName: row.superintendent_name,
    notes: row.notes ?? '',
    lotIds: [...lotIds],
    stages: [...stages],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listProductionActivities() {
  const client = await requireSupabase()
  const activityRows = await listAllRows(() => client
    .from('production_activities')
    .select(ACTIVITY_COLUMNS)
    .eq('status', 'ACTIVE')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true }))
  if (activityRows.length === 0) return []

  const activityIds = activityRows.map(({ id }) => id)
  const [activityLotRows, stageRows, scheduleRows] = await Promise.all([
    listRowsInBatches(
      client,
      activityIds,
      'production_activity_lots',
      ACTIVITY_LOT_COLUMNS,
      'activity_id',
      [['activity_id', true], ['lot_id', true]],
    ),
    listRowsInBatches(
      client,
      activityIds,
      'production_stages',
      STAGE_COLUMNS,
      'activity_id',
      [['activity_id', true], ['id', true]],
    ),
    listRowsInBatches(
      client,
      activityIds,
      'production_schedules',
      SCHEDULE_COLUMNS,
      'activity_id',
      [['activity_id', true], ['scheduled_date', true], ['id', true]],
    ),
  ])

  const activeStages = stageRows.filter(({ is_enabled: isEnabled }) => isEnabled)
  const activeStageIds = new Set(activeStages.map(({ id }) => id))
  const activeSchedules = scheduleRows.filter((row) => (
    row.is_active && activeStageIds.has(row.stage_id)
  ))
  const scheduleIds = activeSchedules.map(({ id }) => id)
  const [scheduleLotRows, historyRows] = await Promise.all([
    listRowsInBatches(
      client,
      scheduleIds,
      'production_schedule_lots',
      SCHEDULE_LOT_COLUMNS,
      'schedule_id',
      [['schedule_id', true], ['lot_id', true]],
    ),
    listRowsInBatches(
      client,
      scheduleIds,
      'production_date_history',
      HISTORY_COLUMNS,
      'schedule_id',
      [['schedule_id', true], ['changed_at', true], ['id', true]],
    ),
  ])

  const activityLots = groupRows(activityLotRows, 'activity_id')
  const stagesByActivity = groupRows(activeStages, 'activity_id')
  const schedulesByStage = groupRows(activeSchedules, 'stage_id')
  const lotsBySchedule = groupRows(scheduleLotRows, 'schedule_id')
  const historyBySchedule = groupRows(historyRows, 'schedule_id')

  return activityRows.map((row) => toActivity(
    row,
    (activityLots.get(row.id) ?? []).map(({ lot_id: lotId }) => lotId),
    (stagesByActivity.get(row.id) ?? []).map((stage) => toStage(
      stage,
      (schedulesByStage.get(stage.id) ?? []).map((schedule) => toSchedule(
        schedule,
        (lotsBySchedule.get(schedule.id) ?? []).map(({ lot_id: lotId }) => lotId),
        historyBySchedule.get(schedule.id) ?? [],
      )),
    )),
  ))
}

export async function saveProductionActivity(values) {
  const client = await requireSupabase()
  const { data: savedActivityId, error } = await client.rpc(
    'save_production_activity',
    toProductionActivityRpc(values),
  )
  throwRepositoryError(error)

  const activities = await listProductionActivities()
  const saved = activities.find(
    (activity) => String(activity.id) === String(savedActivityId),
  )
  if (!saved) {
    throw new Error('The saved Production activity could not be reloaded.')
  }

  return { saved, activities }
}

export async function cancelProductionActivity(activityId) {
  const client = await requireSupabase()
  const { data: cancelledActivityId, error } = await client.rpc(
    'cancel_production_activity',
    toCancelProductionActivityRpc(activityId),
  )
  throwRepositoryError(error)

  return {
    cancelledActivityId,
    activities: await listProductionActivities(),
  }
}
