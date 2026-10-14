export const MIN_DRAW_COUNT = 2
export const MAX_DRAW_COUNT = 5

export const drawEventTypeOptions = [
  { value: 'EXT', label: 'EXT' },
  { value: 'DM', label: 'DM' },
  { value: 'HW', label: 'HW' },
]

export const utilityBillingModeOptions = [
  { value: 'FULL', label: 'Charge 100% in one package' },
  { value: 'BY_EVENT', label: 'Split by Draw events' },
]

export const emptyUtilityEventPercentages = {
  EXT: 0,
  DM: 0,
  HW: 0,
}

export const emptyHardwareEventPercentages = {
  EXT: 0,
  DM: 0,
  HW: 0,
}

export const defaultDraws = [
  { name: '', percentage: 0, eventType: '' },
  { name: '', percentage: 0, eventType: '' },
]

export const frequencyOptions = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'SEMIMONTHLY', label: 'Twice a month' },
  { value: 'WEEKLY', label: 'Weekly' },
]

export const frequencyLabels = Object.fromEntries(
  frequencyOptions.map(({ value, label }) => [value, label]),
)

export const weekdayOptions = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

// Building scope is listed first and is the default for a new setup.
export const invoiceLineFormatOptions = [
  { value: 'BUILDING_SCOPE', label: 'One line per building and scope' },
  { value: 'LOT_SCOPE', label: 'One line per lot and scope' },
]

export const invoiceLineFormatLabels = Object.fromEntries(
  invoiceLineFormatOptions.map(({ value, label }) => [value, label]),
)

export const submissionMethodOptions = [
  { value: 'PORTAL', label: 'Portal' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MAIL', label: 'Mail' },
]

export const submissionMethodLabels = Object.fromEntries(
  submissionMethodOptions.map(({ value, label }) => [value, label]),
)

export const retentionReleaseScopeOptions = [
  { value: 'JOB', label: 'Per Job' },
  { value: 'BUILDING', label: 'Per Building' },
]

export const retentionReleaseScopeLabels = Object.fromEntries(
  retentionReleaseScopeOptions.map(({ value, label }) => [value, label]),
)

// Where the Conditional Final Release applies: the last Package that leaves
// nothing to bill in the Phase, the Building or the whole Project.
export const finalReleaseScopeOptions = [
  { value: 'PHASE', label: 'Per Phase' },
  { value: 'BUILDING', label: 'Per Building' },
  { value: 'PROJECT', label: 'Per Project' },
]

export const finalReleaseScopeLabels = Object.fromEntries(
  finalReleaseScopeOptions.map(({ value, label }) => [value, label]),
)

export const defaultBillingSettings = {
  separateHardwarePrice: false,
  hardwareBillingMode: 'FULL',
  hardwareEventPercentages: { ...emptyHardwareEventPercentages },
  utilityBuilding: false,
  utilityBillingMode: 'FULL',
  utilityEventPercentages: { ...emptyUtilityEventPercentages },
  optionsBillingDrawIndex: null,
  frequency: 'MONTHLY',
  anyDate: false,
  cutoffDay: 20,
  cutoffDays: [10, 25],
  cutoffWeekday: 0,
  paymentTermsDays: 30,
  retentionEnabled: false,
  retentionPercentage: 0,
  retentionReleaseScope: 'JOB',
  ocipWrapEnabled: false,
  ocipWrapPercentage: 0,
  requiresPo: false,
  requiresPaymentSchedule: false,
  requiresRelease: false,
  finalReleaseScope: '',
  requiresBackup: false,
  invoiceLineFormat: 'BUILDING_SCOPE',
  submissionMethod: 'PORTAL',
  submissionDestination: '',
  notes: '',
}

// One complete billing and draw setup per builder. These records merge the
// schedules and profiles that previously lived in separate catalogs.
export const initialBuilderDrawSchedules = [
  {
    id: 1,
    builderId: 2,
    draws: [
      { name: 'Trim Complete', percentage: 10, eventType: 'EXT' },
      { name: '', percentage: 75, eventType: 'DM' },
      { name: '', percentage: 15, eventType: 'HW' },
    ],
    ...defaultBillingSettings,
    frequency: 'WEEKLY',
    cutoffWeekday: 0,
    paymentTermsDays: 21,
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2.5,
    requiresPo: true,
    requiresRelease: true,
    finalReleaseScope: 'PROJECT',
    invoiceLineFormat: 'LOT_SCOPE',
    submissionMethod: 'PORTAL',
    submissionDestination: 'BuilderPortal',
    optionsBillingDrawIndex: 2,
  },
  {
    id: 2,
    builderId: 4,
    draws: [
      { name: '', percentage: 25, eventType: 'EXT' },
      { name: '', percentage: 50, eventType: 'DM' },
      { name: '', percentage: 25, eventType: 'HW' },
    ],
    ...defaultBillingSettings,
    frequency: 'MONTHLY',
    cutoffDay: 20,
    paymentTermsDays: 30,
    retentionEnabled: true,
    retentionPercentage: 10,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 1.5,
    requiresPo: true,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    finalReleaseScope: 'PROJECT',
    submissionMethod: 'PORTAL',
    submissionDestination: 'Textura',
    notes: 'Lien releases must be notarized before submission.',
  },
  {
    id: 3,
    builderId: 1,
    draws: [
      { name: '', percentage: 85, eventType: 'EXT' },
      { name: '', percentage: 15, eventType: 'DM' },
    ],
    ...defaultBillingSettings,
    frequency: 'SEMIMONTHLY',
    cutoffDays: [10, 25],
    paymentTermsDays: 45,
    retentionEnabled: true,
    retentionPercentage: 5,
    ocipWrapEnabled: true,
    ocipWrapPercentage: 2,
    requiresPaymentSchedule: true,
    requiresRelease: true,
    finalReleaseScope: 'PROJECT',
    requiresBackup: true,
    notes: 'Uses their own release form, sent by the PM each month.',
  },
]
