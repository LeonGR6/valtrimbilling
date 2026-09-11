import { createEmptyProductionDraft } from '../data/calendarEvents.js'

function optionalId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function requiredIds(values) {
  return [...new Set((values ?? []).map(Number).filter((id) => (
    Number.isInteger(id) && id > 0
  )))]
}

function optionalNote(value) {
  const note = typeof value === 'string' ? value.trim() : ''
  return note || null
}

function toSchedule(id, variant, date, dateOwner, note, lotIds) {
  return {
    id: optionalId(id),
    variant,
    date,
    dateOwner: dateOwner || 'TENTATIVE',
    note: optionalNote(note),
    lotIds: requiredIds(lotIds),
  }
}

function getSelectedLots(values) {
  return (values.lotIds ?? []).map((id, index) => ({
    id: Number(id),
    lotNumber: Number(values.lotNumbers?.[index]),
  }))
}

function getSplitLotIds(values, part) {
  return getSelectedLots(values)
    .filter(({ lotNumber }) => (
      lotNumber >= Number(part.lotStart) && lotNumber <= Number(part.lotEnd)
    ))
    .map(({ id }) => id)
}

function toPrimarySchedules(values, prefix, variant) {
  const allLotIds = requiredIds(values.lotIds)
  if (!values[`${prefix}SplitPhase`]) {
    return [toSchedule(
      values[`${prefix}ScheduleId`],
      'BASE',
      values[`${prefix}Date`],
      values[`${prefix}DateOwner`],
      values[`${prefix}DateNote`],
      allLotIds,
    )]
  }

  return values[`${prefix}SplitParts`].map((part) => toSchedule(
    part.scheduleId,
    variant,
    part.date,
    part.dateOwner,
    part.note,
    getSplitLotIds(values, part),
  ))
}

export function toProductionActivityRpc(values) {
  const allLotIds = requiredIds(values.lotIds)
  const extSchedules = [toSchedule(
    values.extScheduleId,
    'BASE',
    values.extDate,
    values.extDateOwner,
    values.extDateNote,
    allLotIds,
  )]
  if (values.extInstallOnly) {
    extSchedules.push(toSchedule(
      values.extInstallScheduleId,
      'INSTALL_ONLY',
      values.extInstallDate,
      values.extInstallDateOwner,
      values.extInstallDateNote,
      allLotIds,
    ))
  }

  const stages = [{
    type: 'EXT',
    orderMaterial: Boolean(values.extOrderMaterial),
    schedules: extSchedules,
  }]

  if (values.dmShutters) {
    stages.push({
      type: 'SHUTTER',
      orderMaterial: false,
      schedules: [toSchedule(
        values.shutterScheduleId,
        'BASE',
        values.shutterDate,
        values.shutterDateOwner,
        values.shutterDateNote,
        allLotIds,
      )],
    })
  }

  const dmSchedules = toPrimarySchedules(values, 'dm', 'DIVISION')
  if (values.dmInstallOnly) {
    dmSchedules.push(toSchedule(
      values.dmInstallScheduleId,
      'INSTALL_ONLY',
      values.dmInstallDate,
      values.dmInstallDateOwner,
      values.dmInstallDateNote,
      allLotIds,
    ))
  }
  stages.push({ type: 'DM', orderMaterial: false, schedules: dmSchedules })

  const hwSchedules = toPrimarySchedules(values, 'hw', 'DIVISION')
  if (values.hwLockUp) {
    hwSchedules.push(toSchedule(
      values.hwLockUpScheduleId,
      'LOCK_UP',
      values.hwLockUpDate,
      values.hwLockUpDateOwner,
      values.hwLockUpDateNote,
      allLotIds,
    ))
  }
  stages.push({ type: 'HW', orderMaterial: false, schedules: hwSchedules })

  return {
    p_activity_id: optionalId(values.activityId),
    p_phase_id: Number(values.phaseId),
    p_lot_ids: allLotIds,
    p_stages: stages,
    p_notes: optionalNote(values.notes),
  }
}

export function toCancelProductionActivityRpc(activityId) {
  const persistedActivityId = optionalId(activityId)
  if (!persistedActivityId) {
    throw new Error('Select a persisted Production activity to delete.')
  }

  return { p_activity_id: persistedActivityId }
}

function formatPhase(value) {
  return String(value).toLowerCase().startsWith('phase')
    ? String(value)
    : `Phase ${value}`
}

function formatBuilding(value) {
  return String(value).toLowerCase().startsWith('building')
    ? String(value)
    : `Building ${value}`
}

function scheduleHistory(schedule) {
  return (schedule?.history ?? []).map((entry) => ({
    date: entry.previousDate,
    dateOwner: entry.previousOwner,
    note: entry.previousNote ?? '',
    changedAt: entry.changedAt,
  }))
}

function findSchedule(stage, variant) {
  return stage?.schedules.find((schedule) => schedule.variant === variant) ?? null
}

function primarySchedules(stage) {
  return stage?.schedules.filter((schedule) => (
    schedule.variant === 'BASE' || schedule.variant === 'DIVISION'
  )) ?? []
}

function rangeForSchedule(schedule, lotsById) {
  const lotNumbers = schedule.lotIds
    .map((id) => lotsById.get(String(id))?.lotNumber)
    .filter((value) => value != null)
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  return {
    lotStart: lotNumbers[0],
    lotEnd: lotNumbers.at(-1),
  }
}

function toSplitParts(schedules, lotsById) {
  return schedules.map((schedule) => ({
    id: `production-schedule-${schedule.id}`,
    scheduleId: schedule.id,
    ...rangeForSchedule(schedule, lotsById),
    date: schedule.date,
    dateOwner: schedule.dateOwner,
    note: schedule.note,
    history: scheduleHistory(schedule),
  }))
}

export function toProductionActivityDraft(activity, jobs) {
  const job = jobs.find((candidate) => candidate.id === activity.jobId)
  const phase = job?.sequenceSheet?.phases?.find(
    (candidate) => candidate.id === activity.phaseId,
  )
  if (!job || !phase) return null

  const lotsById = new Map((phase.lots ?? []).map((lot) => [String(lot.id), lot]))
  const selectedLots = activity.lotIds
    .map((id) => lotsById.get(String(id)))
    .filter(Boolean)
    .sort((left, right) => Number(left.lotNumber) - Number(right.lotNumber))
  if (selectedLots.length === 0) return null

  const stages = new Map(activity.stages.map((stage) => [stage.type, stage]))
  const extStage = stages.get('EXT')
  const dmStage = stages.get('DM')
  const hwStage = stages.get('HW')
  const shutterStage = stages.get('SHUTTER')
  const ext = findSchedule(extStage, 'BASE')
  const dmPrimary = primarySchedules(dmStage)
  const hwPrimary = primarySchedules(hwStage)
  const dm = dmPrimary[0]
  const hw = hwPrimary[0]
  if (!ext || !dm || !hw) return null

  const extInstall = findSchedule(extStage, 'INSTALL_ONLY')
  const dmInstall = findSchedule(dmStage, 'INSTALL_ONLY')
  const shutter = findSchedule(shutterStage, 'BASE')
  const lockUp = findSchedule(hwStage, 'LOCK_UP')
  const lotNumbers = selectedLots.map((lot) => String(lot.lotNumber))

  return {
    ...createEmptyProductionDraft(ext.date),
    activityId: activity.id,
    jobId: activity.jobId,
    phaseId: activity.phaseId,
    jobCode: job.code,
    builder: job.builder,
    community: job.community,
    phase: formatPhase(phase.name),
    building: formatBuilding(phase.building),
    lotStart: Number(lotNumbers[0]),
    lotEnd: Number(lotNumbers.at(-1)),
    lotNumbers,
    lotIds: selectedLots.map((lot) => Number(lot.id)),
    foreman: activity.supervisorName,
    superintendent: activity.superintendentName,
    notes: activity.notes,
    extDate: ext.date,
    extDateOwner: ext.dateOwner,
    extDateNote: ext.note,
    extDateHistory: scheduleHistory(ext),
    extScheduleId: ext.id,
    extOrderMaterial: Boolean(extStage.orderMaterial),
    extInstallOnly: Boolean(extInstall),
    extInstallDate: extInstall?.date ?? '',
    extInstallDateOwner: extInstall?.dateOwner ?? '',
    extInstallDateNote: extInstall?.note ?? '',
    extInstallDateHistory: scheduleHistory(extInstall),
    extInstallScheduleId: extInstall?.id ?? null,
    dmShutters: Boolean(shutter),
    shutterDate: shutter?.date ?? '',
    shutterDateOwner: shutter?.dateOwner ?? '',
    shutterDateNote: shutter?.note ?? '',
    shutterDateHistory: scheduleHistory(shutter),
    shutterScheduleId: shutter?.id ?? null,
    dmDate: dm.date,
    dmDateOwner: dm.dateOwner,
    dmDateNote: dm.note,
    dmDateHistory: scheduleHistory(dm),
    dmScheduleId: dm.variant === 'BASE' ? dm.id : null,
    dmInstallOnly: Boolean(dmInstall),
    dmInstallDate: dmInstall?.date ?? '',
    dmInstallDateOwner: dmInstall?.dateOwner ?? '',
    dmInstallDateNote: dmInstall?.note ?? '',
    dmInstallDateHistory: scheduleHistory(dmInstall),
    dmInstallScheduleId: dmInstall?.id ?? null,
    dmSplitPhase: dmPrimary.some((schedule) => schedule.variant === 'DIVISION'),
    dmSplitParts: toSplitParts(
      dmPrimary.filter((schedule) => schedule.variant === 'DIVISION'),
      lotsById,
    ),
    hwDate: hw.date,
    hwDateOwner: hw.dateOwner,
    hwDateNote: hw.note,
    hwDateHistory: scheduleHistory(hw),
    hwScheduleId: hw.variant === 'BASE' ? hw.id : null,
    hwSplitPhase: hwPrimary.some((schedule) => schedule.variant === 'DIVISION'),
    hwSplitParts: toSplitParts(
      hwPrimary.filter((schedule) => schedule.variant === 'DIVISION'),
      lotsById,
    ),
    hwLockUp: Boolean(lockUp),
    hwLockUpDate: lockUp?.date ?? '',
    hwLockUpDateOwner: lockUp?.dateOwner ?? '',
    hwLockUpDateNote: lockUp?.note ?? '',
    hwLockUpDateHistory: scheduleHistory(lockUp),
    hwLockUpScheduleId: lockUp?.id ?? null,
  }
}
