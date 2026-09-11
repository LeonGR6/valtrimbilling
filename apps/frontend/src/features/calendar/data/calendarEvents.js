export const activityTypeOptions = [
  {
    value: 'EXT',
    label: 'EXT FRAMES',
    shortLabel: 'EXT',
    description: 'Exterior frames',
    tone: 'ext',
  },
  {
    value: 'SHUTTER',
    label: 'Shutter',
    shortLabel: 'SHUTTER',
    description: 'Shutter phase',
    tone: 'shutter',
  },
  {
    value: 'DM',
    label: 'DM',
    shortLabel: 'DM',
    description: 'Doors and Material',
    tone: 'dm',
  },
  {
    value: 'HW',
    label: 'Hardware',
    shortLabel: 'HW',
    description: 'Hardware phase',
    tone: 'hw',
  },
]

export const activityTypeMap = Object.fromEntries(
  activityTypeOptions.map((type) => [type.value, type]),
)

export const changeOrderType = {
  value: 'CHANGE_ORDER',
  label: 'Extra / Change Order',
  tone: 'change-order',
}

export const dateOwnerOptions = [
  { value: 'SUPERVISOR', label: 'Supervisor Date', shortLabel: 'Supervisor' },
  { value: 'JOBSITE_SUPERINTENDENT', label: 'Jobsite Superintendent Date', shortLabel: 'Superintendent' },
  { value: 'TENTATIVE', label: 'Tentative Date', shortLabel: 'Tentative' },
]

export const defaultDateOwner = 'TENTATIVE'

const dateOwnerMap = Object.fromEntries(
  dateOwnerOptions.map((option) => [option.value, option]),
)

export function getDateOwnerLabel(value, short = false) {
  const option = dateOwnerMap[value]
  if (!option) return 'Date owner pending'
  return short ? option.shortLabel : option.label
}

export function getActivityTone(activityType, orderMaterial = false) {
  if (activityType === 'EXT' && orderMaterial) return 'ext-order'
  return activityTypeMap[activityType]?.tone ?? 'ext'
}

export function getLotsLabel(lotStart, lotEnd, lotNumbers = []) {
  const normalizedLots = [...new Set(lotNumbers
    .map((lot) => Number(lot))
    .filter(Number.isFinite))]
    .sort((a, b) => a - b)

  if (normalizedLots.length) {
    const ranges = []
    let rangeStart = normalizedLots[0]
    let rangeEnd = normalizedLots[0]

    normalizedLots.slice(1).forEach((lot) => {
      if (lot === rangeEnd + 1) {
        rangeEnd = lot
        return
      }

      ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}–${rangeEnd}`)
      rangeStart = lot
      rangeEnd = lot
    })
    ranges.push(rangeStart === rangeEnd ? `${rangeStart}` : `${rangeStart}–${rangeEnd}`)

    return normalizedLots.length === 1
      ? `Lot ${ranges[0]}`
      : `Lots ${ranges.join(', ')}`
  }

  return Number(lotStart) === Number(lotEnd)
    ? `Lot ${lotStart}`
    : `Lots ${lotStart}–${lotEnd}`
}

export function createEmptyProductionDraft(date = new Date().toISOString().split('T')[0]) {
  return {
    activityId: null,
    calendarType: 'PRODUCTION',
    jobId: '',
    phaseId: '',
    jobCode: '',
    builder: '',
    community: '',
    phase: '',
    building: '',
    lotStart: 1,
    lotEnd: 1,
    lotNumbers: [],
    lotIds: [],
    foreman: '',
    superintendent: '',
    notes: '',
    extDate: date,
    extDateOwner: '',
    extDateNote: '',
    extDateHistory: [],
    extScheduleId: null,
    extOrderMaterial: false,
    extInstallOnly: false,
    extInstallDate: '',
    extInstallDateOwner: '',
    extInstallDateNote: '',
    extInstallDateHistory: [],
    extInstallScheduleId: null,
    dmShutters: false,
    shutterDate: '',
    shutterDateOwner: '',
    shutterDateNote: '',
    shutterDateHistory: [],
    shutterScheduleId: null,
    dmDate: date,
    dmDateOwner: '',
    dmDateNote: '',
    dmDateHistory: [],
    dmScheduleId: null,
    dmInstallOnly: false,
    dmInstallDate: '',
    dmInstallDateOwner: '',
    dmInstallDateNote: '',
    dmInstallDateHistory: [],
    dmInstallScheduleId: null,
    dmSplitPhase: false,
    dmSplitParts: [],
    hwDate: date,
    hwDateOwner: '',
    hwDateNote: '',
    hwDateHistory: [],
    hwScheduleId: null,
    hwSplitPhase: false,
    hwSplitParts: [],
    hwLockUp: false,
    hwLockUpDate: '',
    hwLockUpDateOwner: '',
    hwLockUpDateNote: '',
    hwLockUpDateHistory: [],
    hwLockUpScheduleId: null,
  }
}

export const emptyCalendarDraft = createEmptyProductionDraft()

function buildProductionSchedule(values) {
  return {
    EXT: {
      id: values.extScheduleId,
      date: values.extDate,
      dateOwner: values.extDateOwner,
      note: values.extDateNote,
      history: values.extDateHistory,
      orderMaterial: values.extOrderMaterial,
      installOnly: values.extInstallOnly,
      installDate: values.extInstallDate,
      installDateOwner: values.extInstallDateOwner,
      installDateNote: values.extInstallDateNote,
      installDateHistory: values.extInstallDateHistory,
      installScheduleId: values.extInstallScheduleId,
      splitPhase: false,
      splitParts: [],
    },
    SHUTTER: {
      id: values.shutterScheduleId,
      enabled: values.dmShutters,
      date: values.shutterDate,
      dateOwner: values.shutterDateOwner,
      note: values.shutterDateNote,
      history: values.shutterDateHistory,
      orderMaterial: false,
      installOnly: false,
      installDate: '',
      splitPhase: false,
      splitParts: [],
    },
    DM: {
      id: values.dmScheduleId,
      date: values.dmDate,
      dateOwner: values.dmDateOwner,
      note: values.dmDateNote,
      history: values.dmDateHistory,
      orderMaterial: false,
      installOnly: values.dmInstallOnly,
      installDate: values.dmInstallDate,
      installDateOwner: values.dmInstallDateOwner,
      installDateNote: values.dmInstallDateNote,
      installDateHistory: values.dmInstallDateHistory,
      installScheduleId: values.dmInstallScheduleId,
      splitPhase: values.dmSplitPhase,
      splitParts: values.dmSplitParts,
      shutters: values.dmShutters,
    },
    HW: {
      id: values.hwScheduleId,
      date: values.hwDate,
      dateOwner: values.hwDateOwner,
      note: values.hwDateNote,
      history: values.hwDateHistory,
      orderMaterial: false,
      installOnly: false,
      installDate: '',
      splitPhase: values.hwSplitPhase,
      splitParts: values.hwSplitParts,
      lockUp: values.hwLockUp,
      lockUpDate: values.hwLockUpDate,
      lockUpDateOwner: values.hwLockUpDateOwner,
      lockUpDateNote: values.hwLockUpDateNote,
      lockUpDateHistory: values.hwLockUpDateHistory,
      lockUpScheduleId: values.hwLockUpScheduleId,
    },
  }
}

const stageFieldMap = {
  EXT: {
    date: 'extDate',
    dateOwner: 'extDateOwner',
    note: 'extDateNote',
    history: 'extDateHistory',
    installOnly: 'extInstallOnly',
    installDate: 'extInstallDate',
    installDateOwner: 'extInstallDateOwner',
    installDateNote: 'extInstallDateNote',
    installDateHistory: 'extInstallDateHistory',
    splitPhase: null,
    splitParts: null,
  },
  SHUTTER: {
    date: 'shutterDate',
    dateOwner: 'shutterDateOwner',
    note: 'shutterDateNote',
    history: 'shutterDateHistory',
    installOnly: null,
    installDate: null,
    installDateOwner: null,
    installDateNote: null,
    installDateHistory: null,
    splitPhase: null,
    splitParts: null,
  },
  DM: {
    date: 'dmDate',
    dateOwner: 'dmDateOwner',
    note: 'dmDateNote',
    history: 'dmDateHistory',
    installOnly: 'dmInstallOnly',
    installDate: 'dmInstallDate',
    installDateOwner: 'dmInstallDateOwner',
    installDateNote: 'dmInstallDateNote',
    installDateHistory: 'dmInstallDateHistory',
    splitPhase: 'dmSplitPhase',
    splitParts: 'dmSplitParts',
  },
  HW: {
    date: 'hwDate',
    dateOwner: 'hwDateOwner',
    note: 'hwDateNote',
    history: 'hwDateHistory',
    installOnly: null,
    installDate: null,
    installDateOwner: null,
    installDateNote: null,
    installDateHistory: null,
    lockUp: 'hwLockUp',
    lockUpDate: 'hwLockUpDate',
    lockUpDateOwner: 'hwLockUpDateOwner',
    lockUpDateNote: 'hwLockUpDateNote',
    lockUpDateHistory: 'hwLockUpDateHistory',
    splitPhase: 'hwSplitPhase',
    splitParts: 'hwSplitParts',
  },
}

function normalizedDateOwner(value) {
  return value || defaultDateOwner
}

function appendPreviousDate(history, previous, current, changedAt) {
  const previousOwner = normalizedDateOwner(previous.dateOwner)
  const currentOwner = normalizedDateOwner(current.dateOwner)
  const changed = previous.date !== current.date || previousOwner !== currentOwner

  if (!changed) return [...(history ?? [])]

  return [
    ...(history ?? []),
    {
      date: previous.date,
      dateOwner: previousOwner,
      note: previous.note ?? '',
      changedAt,
    },
  ]
}

export function recordProductionDateHistory(values, previousEvent, changedAt = new Date().toISOString()) {
  const previousSchedule = previousEvent?.extendedProps?.productionSchedule
  if (!previousSchedule) return values

  const nextValues = { ...values }

  Object.entries(stageFieldMap).forEach(([activityType, fields]) => {
    const previousStage = previousSchedule[activityType]
    if (!previousStage) return
    if (activityType === 'SHUTTER' && !previousStage.enabled) return

    nextValues[fields.history] = appendPreviousDate(
      values[fields.history],
      {
        date: previousStage.date,
        dateOwner: previousStage.dateOwner,
        note: previousStage.note,
      },
      {
        date: values[fields.date],
        dateOwner: values[fields.dateOwner],
      },
      changedAt,
    )

    if (fields.installOnly && previousStage.installOnly && values[fields.installOnly]) {
      nextValues[fields.installDateHistory] = appendPreviousDate(
        values[fields.installDateHistory],
        {
          date: previousStage.installDate,
          dateOwner: previousStage.installDateOwner,
          note: previousStage.installDateNote,
        },
        {
          date: values[fields.installDate],
          dateOwner: values[fields.installDateOwner],
        },
        changedAt,
      )
    }

    if (fields.lockUp && previousStage.lockUp && values[fields.lockUp]) {
      nextValues[fields.lockUpDateHistory] = appendPreviousDate(
        values[fields.lockUpDateHistory],
        {
          date: previousStage.lockUpDate,
          dateOwner: previousStage.lockUpDateOwner,
          note: previousStage.lockUpDateNote,
        },
        {
          date: values[fields.lockUpDate],
          dateOwner: values[fields.lockUpDateOwner],
        },
        changedAt,
      )
    }

    if (fields.splitPhase && previousStage.splitPhase && values[fields.splitPhase]) {
      const previousParts = new Map((previousStage.splitParts ?? []).map((part) => [part.id, part]))
      nextValues[fields.splitParts] = values[fields.splitParts].map((part) => {
        const previousPart = previousParts.get(part.id)
        if (!previousPart) return part

        return {
          ...part,
          history: appendPreviousDate(
            part.history,
            previousPart,
            part,
            changedAt,
          ),
        }
      })
    }
  })

  return nextValues
}

export function createProductionCalendarEvents(values, groupId, stamp = Date.now()) {
  const productionSchedule = buildProductionSchedule(values)
  const commonProps = {
    calendarType: 'PRODUCTION',
    activityId: values.activityId ?? null,
    groupId,
    jobId: values.jobId,
    phaseId: values.phaseId,
    jobCode: values.jobCode,
    builder: values.builder,
    community: values.community,
    phase: values.phase,
    building: values.building,
    lotStart: values.lotStart,
    lotEnd: values.lotEnd,
    lotNumbers: values.lotNumbers,
    lotIds: values.lotIds ?? [],
    phaseLotNumbers: values.lotNumbers,
    foreman: values.foreman,
    superintendent: values.superintendent,
    notes: values.notes,
    productionSchedule,
  }

  return activityTypeOptions.flatMap((type) => {
    const stage = productionSchedule[type.value]
    if (type.value === 'SHUTTER' && !stage.enabled) return []

    const schedules = stage.splitPhase
      ? stage.splitParts
      : [{
        lotStart: values.lotStart,
        lotEnd: values.lotEnd,
        date: stage.date,
        dateOwner: stage.dateOwner,
        note: stage.note,
        history: stage.history,
      }]
    const stageEvents = schedules.map((schedule, index) => {
      const scheduleLotNumbers = values.lotNumbers.filter((lot) => (
        Number(lot) >= Number(schedule.lotStart) && Number(lot) <= Number(schedule.lotEnd)
      ))

      return {
        id: schedule.scheduleId || schedule.id || stage.id
          ? `production-schedule-${schedule.scheduleId ?? schedule.id ?? stage.id}`
          : `${groupId}-${type.value.toLowerCase()}-${stamp}-${index}`,
        groupId,
        title: `${type.label} • ${getLotsLabel(schedule.lotStart, schedule.lotEnd, scheduleLotNumbers)}`,
        start: schedule.date,
        allDay: true,
        extendedProps: {
          ...commonProps,
          activityType: type.value,
          scheduleId: schedule.scheduleId ?? schedule.id ?? stage.id ?? null,
          dateOwner: schedule.dateOwner ?? stage.dateOwner,
          dateNote: schedule.note ?? stage.note ?? '',
          dateHistory: schedule.history ?? stage.history ?? [],
          lotStart: schedule.lotStart,
          lotEnd: schedule.lotEnd,
          lotNumbers: scheduleLotNumbers,
          orderMaterial: Boolean(stage.orderMaterial),
          installOnly: Boolean(stage.installOnly),
          installDate: stage.installDate ?? '',
          splitPhase: Boolean(stage.splitPhase),
          splitParts: stage.splitParts ?? [],
          lockUp: Boolean(stage.lockUp),
          lockUpDate: stage.lockUpDate ?? '',
          variant: stage.splitPhase ? 'division' : 'base',
        },
      }
    })

    if (stage.installOnly) {
      stageEvents.push({
        id: stage.installScheduleId
          ? `production-schedule-${stage.installScheduleId}`
          : `${groupId}-${type.value.toLowerCase()}-install-${stamp}`,
        groupId,
        title: `${type.label} INSTALL ONLY • ${getLotsLabel(values.lotStart, values.lotEnd, values.lotNumbers)}`,
        start: stage.installDate,
        allDay: true,
        extendedProps: {
          ...commonProps,
          activityType: type.value,
          scheduleId: stage.installScheduleId ?? null,
          dateOwner: stage.installDateOwner,
          dateNote: stage.installDateNote ?? '',
          dateHistory: stage.installDateHistory ?? [],
          lotStart: values.lotStart,
          lotEnd: values.lotEnd,
          lotNumbers: values.lotNumbers,
          orderMaterial: Boolean(stage.orderMaterial),
          installOnly: true,
          installDate: stage.installDate,
          splitPhase: Boolean(stage.splitPhase),
          splitParts: stage.splitParts ?? [],
          lockUp: Boolean(stage.lockUp),
          variant: 'install-only',
        },
      })
    }

    if (type.value === 'HW' && stage.lockUp) {
      stageEvents.push({
        id: stage.lockUpScheduleId
          ? `production-schedule-${stage.lockUpScheduleId}`
          : `${groupId}-${type.value.toLowerCase()}-lock-up-${stamp}`,
        groupId,
        title: `${type.label} LOCK UP • ${getLotsLabel(values.lotStart, values.lotEnd, values.lotNumbers)}`,
        start: stage.lockUpDate,
        allDay: true,
        extendedProps: {
          ...commonProps,
          activityType: type.value,
          scheduleId: stage.lockUpScheduleId ?? null,
          dateOwner: stage.lockUpDateOwner,
          dateNote: stage.lockUpDateNote ?? '',
          dateHistory: stage.lockUpDateHistory ?? [],
          lotStart: values.lotStart,
          lotEnd: values.lotEnd,
          lotNumbers: values.lotNumbers,
          orderMaterial: false,
          installOnly: false,
          installDate: '',
          splitPhase: Boolean(stage.splitPhase),
          splitParts: stage.splitParts ?? [],
          lockUp: true,
          lockUpDate: stage.lockUpDate,
          variant: 'lock-up',
        },
      })
    }

    return stageEvents
  })
}

export function createDraftFromProductionEvent(event) {
  const props = event.extendedProps
  const schedule = props.productionSchedule
  const shutterSchedule = schedule.SHUTTER ?? {}
  const phaseLotNumbers = props.phaseLotNumbers ?? props.lotNumbers ?? []

  return {
    ...createEmptyProductionDraft(schedule.EXT.date),
    activityId: props.activityId ?? null,
    jobId: props.jobId,
    phaseId: props.phaseId,
    jobCode: props.jobCode,
    builder: props.builder,
    community: props.community,
    phase: props.phase,
    building: props.building,
    lotStart: phaseLotNumbers[0] ?? props.lotStart,
    lotEnd: phaseLotNumbers.at(-1) ?? props.lotEnd,
    lotNumbers: phaseLotNumbers,
    lotIds: props.lotIds ?? [],
    foreman: props.foreman ?? '',
    superintendent: props.superintendent ?? '',
    notes: props.notes ?? '',
    extDate: schedule.EXT.date,
    extDateOwner: schedule.EXT.dateOwner ?? '',
    extDateNote: schedule.EXT.note ?? '',
    extDateHistory: (schedule.EXT.history ?? []).map((entry) => ({ ...entry })),
    extScheduleId: schedule.EXT.id ?? null,
    extOrderMaterial: Boolean(schedule.EXT.orderMaterial),
    extInstallOnly: Boolean(schedule.EXT.installOnly),
    extInstallDate: schedule.EXT.installDate ?? '',
    extInstallDateOwner: schedule.EXT.installDateOwner ?? '',
    extInstallDateNote: schedule.EXT.installDateNote ?? '',
    extInstallDateHistory: (schedule.EXT.installDateHistory ?? []).map((entry) => ({ ...entry })),
    extInstallScheduleId: schedule.EXT.installScheduleId ?? null,
    dmShutters: Boolean(schedule.DM.shutters ?? shutterSchedule.enabled),
    shutterDate: shutterSchedule.date ?? '',
    shutterDateOwner: shutterSchedule.dateOwner ?? '',
    shutterDateNote: shutterSchedule.note ?? '',
    shutterDateHistory: (shutterSchedule.history ?? []).map((entry) => ({ ...entry })),
    shutterScheduleId: shutterSchedule.id ?? null,
    dmDate: schedule.DM.date,
    dmDateOwner: schedule.DM.dateOwner ?? '',
    dmDateNote: schedule.DM.note ?? '',
    dmDateHistory: (schedule.DM.history ?? []).map((entry) => ({ ...entry })),
    dmScheduleId: schedule.DM.id ?? null,
    dmInstallOnly: Boolean(schedule.DM.installOnly),
    dmInstallDate: schedule.DM.installDate ?? '',
    dmInstallDateOwner: schedule.DM.installDateOwner ?? '',
    dmInstallDateNote: schedule.DM.installDateNote ?? '',
    dmInstallDateHistory: (schedule.DM.installDateHistory ?? []).map((entry) => ({ ...entry })),
    dmInstallScheduleId: schedule.DM.installScheduleId ?? null,
    dmSplitPhase: Boolean(schedule.DM.splitPhase),
    dmSplitParts: (schedule.DM.splitParts ?? []).map((part) => ({
      ...part,
      history: (part.history ?? []).map((entry) => ({ ...entry })),
    })),
    hwDate: schedule.HW.date,
    hwDateOwner: schedule.HW.dateOwner ?? '',
    hwDateNote: schedule.HW.note ?? '',
    hwDateHistory: (schedule.HW.history ?? []).map((entry) => ({ ...entry })),
    hwScheduleId: schedule.HW.id ?? null,
    hwSplitPhase: Boolean(schedule.HW.splitPhase),
    hwSplitParts: (schedule.HW.splitParts ?? []).map((part) => ({
      ...part,
      history: (part.history ?? []).map((entry) => ({ ...entry })),
    })),
    hwLockUp: Boolean(schedule.HW.lockUp),
    hwLockUpDate: schedule.HW.lockUpDate ?? '',
    hwLockUpDateOwner: schedule.HW.lockUpDateOwner ?? '',
    hwLockUpDateNote: schedule.HW.lockUpDateNote ?? '',
    hwLockUpDateHistory: (schedule.HW.lockUpDateHistory ?? []).map((entry) => ({ ...entry })),
    hwLockUpScheduleId: schedule.HW.lockUpScheduleId ?? null,
  }
}
