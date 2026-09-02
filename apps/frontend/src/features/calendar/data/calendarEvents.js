export const activityTypeOptions = [
  {
    value: 'EXT',
    label: 'EXT FRAMES',
    shortLabel: 'EXT',
    description: 'Exterior frames',
    tone: 'ext',
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

export function getActivityTone(activityType, orderMaterial = false) {
  if (activityType === 'EXT' && orderMaterial) return 'ext-order'
  return activityTypeMap[activityType]?.tone ?? 'ext'
}

export function getLotsLabel(lotStart, lotEnd) {
  return Number(lotStart) === Number(lotEnd)
    ? `Lot ${lotStart}`
    : `Lots ${lotStart}–${lotEnd}`
}

export function createEmptyProductionDraft(date = '2026-08-10') {
  return {
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
    foreman: '',
    superintendent: '',
    notes: '',
    extDate: date,
    extOrderMaterial: false,
    extInstallOnly: false,
    extInstallDate: '',
    dmDate: date,
    dmInstallOnly: false,
    dmInstallDate: '',
    dmSplitPhase: false,
    dmSplitParts: [],
    dmShutters: false,
    hwDate: date,
    hwSplitPhase: false,
    hwSplitParts: [],
    hwLockUp: false,
  }
}

export const emptyCalendarDraft = createEmptyProductionDraft()

function buildProductionSchedule(values) {
  return {
    EXT: {
      date: values.extDate,
      orderMaterial: values.extOrderMaterial,
      installOnly: values.extInstallOnly,
      installDate: values.extInstallDate,
      splitPhase: false,
      splitParts: [],
    },
    DM: {
      date: values.dmDate,
      orderMaterial: false,
      installOnly: values.dmInstallOnly,
      installDate: values.dmInstallDate,
      splitPhase: values.dmSplitPhase,
      splitParts: values.dmSplitParts,
      shutters: values.dmShutters,
    },
    HW: {
      date: values.hwDate,
      orderMaterial: false,
      installOnly: false,
      installDate: '',
      splitPhase: values.hwSplitPhase,
      splitParts: values.hwSplitParts,
      lockUp: values.hwLockUp,
    },
  }
}

export function createProductionCalendarEvents(values, groupId, stamp = Date.now()) {
  const productionSchedule = buildProductionSchedule(values)
  const commonProps = {
    calendarType: 'PRODUCTION',
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
    foreman: values.foreman,
    superintendent: values.superintendent,
    notes: values.notes,
    productionSchedule,
  }

  return activityTypeOptions.flatMap((type) => {
    const stage = productionSchedule[type.value]
    const schedules = stage.splitPhase
      ? stage.splitParts
      : [{ lotStart: values.lotStart, lotEnd: values.lotEnd, date: stage.date }]
    const stageEvents = schedules.map((schedule, index) => ({
      id: `${groupId}-${type.value.toLowerCase()}-${stamp}-${index}`,
      groupId,
      title: `${type.label} • ${getLotsLabel(schedule.lotStart, schedule.lotEnd)}`,
      start: schedule.date,
      allDay: true,
      extendedProps: {
        ...commonProps,
        activityType: type.value,
        lotStart: schedule.lotStart,
        lotEnd: schedule.lotEnd,
        orderMaterial: Boolean(stage.orderMaterial),
        installOnly: Boolean(stage.installOnly),
        installDate: stage.installDate ?? '',
        splitPhase: Boolean(stage.splitPhase),
        splitParts: stage.splitParts ?? [],
        shutters: Boolean(stage.shutters),
        lockUp: Boolean(stage.lockUp),
        variant: stage.splitPhase ? 'division' : 'base',
      },
    }))

    if (stage.installOnly) {
      stageEvents.push({
        id: `${groupId}-${type.value.toLowerCase()}-install-${stamp}`,
        groupId,
        title: `${type.label} INSTALL ONLY • ${getLotsLabel(values.lotStart, values.lotEnd)}`,
        start: stage.installDate,
        allDay: true,
        extendedProps: {
          ...commonProps,
          activityType: type.value,
          lotStart: values.lotStart,
          lotEnd: values.lotEnd,
          orderMaterial: Boolean(stage.orderMaterial),
          installOnly: true,
          installDate: stage.installDate,
          splitPhase: Boolean(stage.splitPhase),
          splitParts: stage.splitParts ?? [],
          shutters: Boolean(stage.shutters),
          lockUp: Boolean(stage.lockUp),
          variant: 'install-only',
        },
      })
    }

    return stageEvents
  })
}

export function createDraftFromProductionEvent(event) {
  const props = event.extendedProps
  const schedule = props.productionSchedule

  return {
    ...createEmptyProductionDraft(schedule.EXT.date),
    jobId: props.jobId,
    phaseId: props.phaseId,
    jobCode: props.jobCode,
    builder: props.builder,
    community: props.community,
    phase: props.phase,
    building: props.building,
    lotStart: props.lotNumbers?.[0] ?? props.lotStart,
    lotEnd: props.lotNumbers?.at(-1) ?? props.lotEnd,
    lotNumbers: props.lotNumbers ?? [],
    foreman: props.foreman ?? '',
    superintendent: props.superintendent ?? '',
    notes: props.notes ?? '',
    extDate: schedule.EXT.date,
    extOrderMaterial: Boolean(schedule.EXT.orderMaterial),
    extInstallOnly: Boolean(schedule.EXT.installOnly),
    extInstallDate: schedule.EXT.installDate ?? '',
    dmDate: schedule.DM.date,
    dmInstallOnly: Boolean(schedule.DM.installOnly),
    dmInstallDate: schedule.DM.installDate ?? '',
    dmSplitPhase: Boolean(schedule.DM.splitPhase),
    dmSplitParts: (schedule.DM.splitParts ?? []).map((part) => ({ ...part })),
    dmShutters: Boolean(schedule.DM.shutters),
    hwDate: schedule.HW.date,
    hwSplitPhase: Boolean(schedule.HW.splitPhase),
    hwSplitParts: (schedule.HW.splitParts ?? []).map((part) => ({ ...part })),
    hwLockUp: Boolean(schedule.HW.lockUp),
  }
}

const demoActivityOne = {
  ...createEmptyProductionDraft('2026-08-10'),
  jobId: 1,
  phaseId: 2102,
  jobCode: '1307',
  builder: 'Trumark Homes',
  community: 'Andara',
  phase: 'Phase 2',
  building: 'Building 15',
  lotStart: 66,
  lotEnd: 70,
  lotNumbers: ['66', '67', '68', '69', '70'],
  foreman: 'Lauren Mitchell',
  superintendent: 'Daniel Torres',
  notes: 'Production schedule for the full phase.',
  extDate: '2026-08-10',
  extOrderMaterial: true,
  dmDate: '2026-08-11',
  dmShutters: true,
  hwDate: '2026-08-12',
}

const demoActivityTwo = {
  ...createEmptyProductionDraft('2026-08-17'),
  jobId: 1,
  phaseId: 2101,
  jobCode: '1307',
  builder: 'Trumark Homes',
  community: 'Andara',
  phase: 'Phase 3',
  building: 'Building 5',
  lotStart: 18,
  lotEnd: 22,
  lotNumbers: ['18', '19', '20', '21', '22'],
  foreman: 'Lauren Mitchell',
  superintendent: 'Daniel Torres',
  notes: 'Second production sequence for Job 1307.',
  extDate: '2026-08-17',
  dmDate: '2026-08-18',
  hwDate: '2026-08-19',
}

export const initialCalendarEvents = [
  ...createProductionCalendarEvents(demoActivityOne, 'production-1307-2102', 101),
  ...createProductionCalendarEvents(demoActivityTwo, 'production-1307-2101', 102),
]
